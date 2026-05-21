import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { registerUser } from "@/lib/auth";
import {
  isPlatformMailerConfigured,
  sendVerificationEmail,
} from "@/lib/services/platform-mailer";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, companyName, companyWebsite } = body || {};

    if (!isPlatformMailerConfigured()) {
      return NextResponse.json(
        {
          error:
            "Account registration is temporarily unavailable: the platform email service isn't configured. Please contact support.",
        },
        { status: 503 }
      );
    }

    const result = await registerUser({ email, password, name, companyName, companyWebsite });

    if (!result.ok || !result.user || !result.verifyToken) {
      return NextResponse.json(
        { error: result.error || "Registration failed" },
        { status: 400 }
      );
    }

    try {
      await sendVerificationEmail({
        to: result.user.email,
        recipientName: name || null,
        token: result.verifyToken,
      });
    } catch (e) {
      // Roll back the user so registration can be retried — otherwise the
      // email is taken and the user would be stuck without a way to verify.
      console.error("[register] Failed to send verification email — rolling back user:", e);
      await prisma.user
        .delete({ where: { id: result.user.id } })
        .catch((err) => console.error("[register] Rollback failed:", err));
      return NextResponse.json(
        {
          error:
            "Failed to send verification email. Please try again or contact support.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      email: result.user.email,
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
