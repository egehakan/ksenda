import { NextResponse } from "next/server";
import { clearAdminAuthCookie } from "@/lib/admin/auth";

export const maxDuration = 300;

export async function POST() {
  try {
    await clearAdminAuthCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
