import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PIPELINE_STATES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createJob } from "@/lib/services/jobs";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/pipeline/send-all — dispatches a background job to send every
 * APPROVED_TO_SEND email. Returns immediately; progress lives in the jobs
 * widget.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const companies = await prisma.company.findMany({
      where: {
        userId: user.id,
        pipelineState: PIPELINE_STATES.APPROVED_TO_SEND,
        targetContactEmail: { not: null },
      },
      include: { email: true },
      orderBy: { updatedAt: "asc" },
    });

    const companyIds = companies
      .filter((c) => c.email && c.targetContactEmail)
      .map((c) => c.id);

    if (companyIds.length === 0) {
      return NextResponse.json({
        success: true,
        queued: false,
        total: 0,
        message: "No companies ready to send",
      });
    }

    const jobId = await createJob({
      userId: user.id,
      kind: "single_generation",
      totalItems: companyIds.length,
      currentLabel: `Queued ${companyIds.length} sends…`,
    });
    if (!jobId)
      return NextResponse.json(
        { error: "Failed to create progress job" },
        { status: 500 }
      );

    await inngest.send({
      name: EVENTS.pipelineSendBatch,
      data: { userId: user.id, jobId, companyIds },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      jobId,
      total: companyIds.length,
      message: `Sending ${companyIds.length} emails in the background.`,
    });
  } catch (error) {
    console.error("Error dispatching send-all:", error);
    return NextResponse.json(
      { error: "Failed to queue send-all" },
      { status: 500 }
    );
  }
}
