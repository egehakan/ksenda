import { NextRequest, NextResponse } from "next/server";
import { loginUser, createToken, setAuthCookie } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const result = await loginUser(email, password);

    if (!result.ok || !result.user) {
      return NextResponse.json(
        {
          error: result.error || "Invalid email or password",
          needsVerification: result.needsVerification === true,
        },
        { status: result.needsVerification ? 403 : 401 }
      );
    }

    const token = await createToken({ userId: result.user.id, email: result.user.email });
    await setAuthCookie(token);

    return NextResponse.json({
      success: true,
      user: { email: result.user.email },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
