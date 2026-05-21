/**
 * POST /api/followups/batch-mark-sent
 *
 * LinkedIn manual-send path for follow-ups. User reviewed N LinkedIn
 * follow-up DMs in the LinkedInSendModal, opened each profile, sent
 * manually, and clicked "Done". We mark each FollowUpEmail row sent and
 * advance the parent Company's follow-up step.
 *
 * Body: { followUpEmailIds: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markFollowUpAsSent } from "@/lib/services/followup";
import prisma from "@/lib/prisma";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { followUpEmailIds } = body as { followUpEmailIds: string[] };
    if (!Array.isArray(followUpEmailIds) || followUpEmailIds.length === 0) {
      return NextResponse.json(
        { error: "followUpEmailIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Only mark-sent LinkedIn-channel rows owned by this user that aren't
    // already sent.
    const eligible = await prisma.followUpEmail.findMany({
      where: {
        id: { in: followUpEmailIds },
        company: { userId: user.id },
        channel: "linkedin",
        sentAt: null,
      },
      select: { id: true },
    });
    const eligibleIds = eligible.map((e) => e.id);

    const results = await Promise.all(
      eligibleIds.map(async (id) => {
        const res = await markFollowUpAsSent(user.id, id, user.email);
        return { id, ...res };
      })
    );
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    return NextResponse.json({
      success: true,
      total: followUpEmailIds.length,
      eligible: eligibleIds.length,
      succeeded,
      failed: failed.length,
      failures: failed.map((f) => ({ id: f.id, error: f.error })),
    });
  } catch (error) {
    console.error("POST /api/followups/batch-mark-sent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
