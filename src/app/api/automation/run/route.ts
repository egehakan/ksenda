import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { blockIfJobActive } from "@/lib/active-job-guard";

export const maxDuration = 300;

/**
 * POST /api/automation/run — dispatches a background automation run. The
 * orchestrator (`orchestrateRun`) creates its own GenerationJob and runs
 * every enabled stage in order. Future Vercel Cron can call this same
 * route to fire daily runs.
 *
 * Body (optional): { channels?: ("email" | "linkedin")[] }
 * When omitted, all of today's CampaignDay rows run (default behaviour).
 * When provided, stage 1 only processes rows whose channel is in the list
 * — letting the Today card give users per-run channel control.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // App-wide single-flight — see blockIfJobActive.
    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => ({}))) as {
      channels?: string[];
    };
    const allowed: Array<"email" | "linkedin"> = Array.isArray(body?.channels)
      ? body.channels.filter(
          (c): c is "email" | "linkedin" =>
            c === "email" || c === "linkedin"
        )
      : [];

    await inngest.send({
      name: EVENTS.automationRun,
      data: {
        userId: user.id,
        // Only include the field when the client explicitly set it. An empty
        // or absent `channels` array means "run everything", matching the
        // pre-toggle behaviour.
        ...(allowed.length > 0 ? { channels: allowed } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      message:
        "Automation run queued. Progress will appear in the jobs widget.",
    });
  } catch (error) {
    console.error("POST /api/automation/run error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run failed" },
      { status: 500 }
    );
  }
}
