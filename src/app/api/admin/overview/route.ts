import { NextResponse } from "next/server";
import {
  getEmailsSentByDay,
  getOverviewKpis,
  getPipelineBreakdown,
  getRecentActivity,
} from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/admin/auth";

export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const [kpis, sentByDay, pipeline, activity] = await Promise.all([
      getOverviewKpis(),
      getEmailsSentByDay("30d"),
      getPipelineBreakdown(),
      getRecentActivity(50),
    ]);
    return NextResponse.json({ kpis, sentByDay, pipeline, activity });
  } catch (error) {
    console.error("Admin overview error:", error);
    return NextResponse.json(
      { error: "Failed to load overview" },
      { status: 500 }
    );
  }
}
