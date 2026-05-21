import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName,
        companyWebsite: user.companyWebsite,
        senderEmail: user.senderEmail,
        senderName: user.senderName,
        signature: user.signature,
        smtpProvider: user.smtpProvider,
        smtpHost: user.smtpHost,
        smtpPort: user.smtpPort,
        smtpSecure: user.smtpSecure,
        smtpUser: user.smtpUser,
        // Don't ever return secrets
        hasApolloKey: !!user.apolloApiKey,
        hasGeminiKey: !!user.geminiApiKey,
        hasSmtpPassword: !!user.smtpPassword,
        onboardingStep: user.onboardingStep,
        onboardingCompletedAt: user.onboardingCompletedAt,
      },
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
