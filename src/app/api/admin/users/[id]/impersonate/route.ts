import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { startImpersonation } from "@/lib/admin/impersonation";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const result = await startImpersonation(admin.id, admin.email, id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Impersonate error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to impersonate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
