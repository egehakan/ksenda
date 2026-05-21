import { NextRequest, NextResponse } from "next/server";
import { regenerateVerifyToken } from "@/lib/auth";
import {
  isPlatformMailerConfigured,
  sendVerificationEmail,
} from "@/lib/services/platform-mailer";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}));

    if (!isPlatformMailerConfigured()) {
      return NextResponse.json(
        { error: "Verification email service is not configured." },
        { status: 503 }
      );
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        // Generic success — don't reveal whether the email exists.
        { success: true, message: "If that account exists, a verification email has been sent." }
      );
    }

    const result = await regenerateVerifyToken(email);
    if (result.send) {
      try {
        await sendVerificationEmail({
          to: result.send.email,
          recipientName: result.send.name,
          token: result.send.token,
        });
      } catch (e) {
        console.error("[resend-verification] Send failed:", e);
        // Still return generic success — don't leak existence.
      }
    }

    return NextResponse.json({
      success: true,
      message: "If that account exists, a verification email has been sent.",
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
