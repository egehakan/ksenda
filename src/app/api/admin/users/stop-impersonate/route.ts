import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { stopImpersonation } from "@/lib/admin/impersonation";

export const maxDuration = 300;

export async function POST() {
  try {
    const admin = await requireAdmin();
    const result = await stopImpersonation(admin.email);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Stop impersonation error:", error);
    return NextResponse.json(
      { error: "Failed to stop impersonation" },
      { status: 500 }
    );
  }
}
