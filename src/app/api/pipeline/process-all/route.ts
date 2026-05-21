import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PIPELINE_STATES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createJob } from "@/lib/services/jobs";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/pipeline/process-all — dispatches a background job to find a
 * contact and generate an email for every PENDING_GENERATION company.
 *
 * Returns immediately with `{ jobId, total, queued: true }` so the
 * request doesn't hold the connection open. The frontend's existing
 * jobs widget (driven by `/api/jobs/active`) shows live progress.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.apolloApiKey || !user.geminiApiKey) {
      return NextResponse.json(
        {
          error:
            "Apollo and Gemini API keys must both be configured. Please add them in Settings.",
        },
        { status: 400 }
      );
    }

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const { customPrompt } = body as { customPrompt?: string };

    const companies = await prisma.company.findMany({
      where: {
        userId: user.id,
        pipelineState: PIPELINE_STATES.PENDING_GENERATION,
      },
      include: { email: true },
      orderBy: { createdAt: "asc" },
    });

    const companyIds = companies.filter((c) => !c.email).map((c) => c.id);

    if (companyIds.length === 0) {
      return NextResponse.json({
        success: true,
        queued: false,
        total: 0,
        message: "No companies in pending_generation state",
      });
    }

    const jobId = await createJob({
      userId: user.id,
      kind: "single_generation",
      totalItems: companyIds.length,
      currentLabel: `Queued ${companyIds.length} companies…`,
    });

    if (!jobId) {
      return NextResponse.json(
        { error: "Failed to create progress job" },
        { status: 500 }
      );
    }

    await inngest.send({
      name: EVENTS.pipelineProcessBatch,
      data: { userId: user.id, jobId, companyIds, customPrompt },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      jobId,
      total: companyIds.length,
      message: `Processing ${companyIds.length} companies in the background. Watch the progress widget.`,
    });
  } catch (error) {
    console.error("Error dispatching process-all:", error);
    return NextResponse.json(
      {
        error: "Failed to queue process-all",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
