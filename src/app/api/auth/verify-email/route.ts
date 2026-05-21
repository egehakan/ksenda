import { NextRequest, NextResponse } from "next/server";
import { createToken, setAuthCookie, verifyEmailToken } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json().catch(() => ({}));
    const result = await verifyEmailToken(token);

    if (!result.ok || !result.user) {
      return NextResponse.json(
        { error: result.error || "Verification failed" },
        { status: 400 }
      );
    }

    const jwt = await createToken({ userId: result.user.id, email: result.user.email });
    await setAuthCookie(jwt);

    return NextResponse.json({
      success: true,
      user: { email: result.user.email },
    });
  } catch (error) {
    console.error("Verify-email error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
