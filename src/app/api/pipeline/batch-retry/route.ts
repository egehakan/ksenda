import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PIPELINE_STATES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createJob } from "@/lib/services/jobs";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/pipeline/batch-retry — dispatches a background job to retry
 * email generation for the supplied EMAIL_NOT_GENERATED companies (each
 * already has a target contact). Returns immediately.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.geminiApiKey) {
      return NextResponse.json(
        {
          error: "Gemini API key is not configured. Please add it in Settings.",
        },
        { status: 400 }
      );
    }

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = await request.json();
    const { companyIds, customPrompt } = body as {
      companyIds: string[];
      customPrompt?: string;
    };

    if (!companyIds || companyIds.length === 0) {
      return NextResponse.json(
        { error: "No company IDs provided" },
        { status: 400 }
      );
    }

    const companies = await prisma.company.findMany({
      where: {
        id: { in: companyIds },
        userId: user.id,
        pipelineState: PIPELINE_STATES.EMAIL_NOT_GENERATED,
        targetContactEmail: { not: null },
      },
      select: { id: true },
    });

    const validIds = companies.map((c) => c.id);

    if (validIds.length === 0) {
      return NextResponse.json({
        success: true,
        queued: false,
        total: 0,
        message: "No companies with contacts found to retry",
      });
    }

    const jobId = await createJob({
      userId: user.id,
      kind: "single_generation",
      totalItems: validIds.length,
      currentLabel: `Queued ${validIds.length} retries…`,
    });
    if (!jobId)
      return NextResponse.json(
        { error: "Failed to create progress job" },
        { status: 500 }
      );

    await inngest.send({
      name: EVENTS.pipelineRetryBatch,
      data: { userId: user.id, jobId, companyIds: validIds, customPrompt },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      jobId,
      total: validIds.length,
      message: `Retrying ${validIds.length} email generations in the background.`,
    });
  } catch (error) {
    console.error("Error dispatching batch-retry:", error);
    return NextResponse.json(
      { error: "Failed to queue batch-retry" },
      { status: 500 }
    );
  }
}
