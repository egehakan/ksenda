/**
 * POST /api/pipeline/batch-mark-sent
 *
 * LinkedIn manual-send path. The user pasted N LinkedIn messages into their
 * own LinkedIn account and pressed "Done" in the LinkedInSendModal. We just
 * mark each Company's Email row sent and advance the company into the client
 * lifecycle. Mirrors the success branch of sendApprovedEmail (in
 * email-sender.ts) minus the SMTP call.
 *
 * Body: { companyIds: string[] }
 *
 * Only companies whose Email.channel === 'linkedin' and whose pipelineState
 * is APPROVED_TO_SEND are processed; others are reported as skipped.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markInitialEmailAsSent } from "@/lib/services/email-sender";
import prisma from "@/lib/prisma";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { companyIds } = body as { companyIds: string[] };
    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Pre-fetch to give the caller meaningful skipped/eligible counts.
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds }, userId: user.id },
      include: { email: true },
    });
    const eligibleIds = companies
      .filter(
        (c) =>
          c.pipelineState === "approved_to_send" &&
          c.email &&
          (c.email.channel || "email") === "linkedin"
      )
      .map((c) => c.id);

    const results = await Promise.all(
      eligibleIds.map(async (companyId) => {
        const res = await markInitialEmailAsSent(user.id, companyId, user.email);
        return { companyId, ...res };
      })
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    return NextResponse.json({
      success: true,
      total: companyIds.length,
      eligible: eligibleIds.length,
      succeeded,
      failed: failed.length,
      failures: failed.map((f) => ({ companyId: f.companyId, error: f.error })),
    });
  } catch (error) {
    console.error("POST /api/pipeline/batch-mark-sent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
