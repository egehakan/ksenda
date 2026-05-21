import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/followups/process — dispatches a background job that finds
 * every company whose `nextFollowUpAt` has elapsed, generates the next
 * follow-up email via Gemini, and stores it pending-review. The service
 * (`processDueFollowUps`) creates its own GenerationJob.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.geminiApiKey) {
      return NextResponse.json(
        { error: "Gemini API key is not configured. Add it in Settings." },
        { status: 400 }
      );
    }

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    await inngest.send({
      name: EVENTS.followupsProcess,
      data: { userId: user.id },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      message:
        "Processing due follow-ups in the background. Progress will appear in the jobs widget.",
    });
  } catch (error) {
    console.error("POST /api/followups/process error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to queue follow-ups",
      },
      { status: 500 }
    );
  }
}
