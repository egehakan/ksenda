import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PIPELINE_STATES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createJob } from "@/lib/services/jobs";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/pipeline/batch-send — dispatches a background job to send the
 * supplied APPROVED_TO_SEND emails. Returns immediately.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = await request.json();
    const { companyIds } = body as { companyIds: string[] };

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
        pipelineState: PIPELINE_STATES.APPROVED_TO_SEND,
        targetContactEmail: { not: null },
      },
      include: { email: true },
    });

    // SMTP batch-send is for email channel only. LinkedIn rows go through the
    // separate /api/pipeline/batch-mark-sent path (manual send by the user).
    const validIds = companies
      .filter(
        (c) =>
          c.email &&
          c.targetContactEmail &&
          (c.email.channel || "email") === "email"
      )
      .map((c) => c.id);

    if (validIds.length === 0) {
      return NextResponse.json({
        success: true,
        queued: false,
        total: 0,
        message: "No companies ready to send",
      });
    }

    const jobId = await createJob({
      userId: user.id,
      kind: "pipeline_send",
      totalItems: validIds.length,
      currentLabel: `Queued ${validIds.length} sends…`,
    });
    if (!jobId)
      return NextResponse.json(
        { error: "Failed to create progress job" },
        { status: 500 }
      );

    await inngest.send({
      name: EVENTS.pipelineSendBatch,
      data: { userId: user.id, jobId, companyIds: validIds },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      jobId,
      total: validIds.length,
      message: `Sending ${validIds.length} emails in the background.`,
    });
  } catch (error) {
    console.error("Error dispatching batch-send:", error);
    return NextResponse.json(
      { error: "Failed to queue batch-send" },
      { status: 500 }
    );
  }
}
