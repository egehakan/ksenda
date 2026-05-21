import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifySmtpConfig } from "@/lib/services/email-sender";

export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const result = await verifySmtpConfig({
    smtpProvider: user.smtpProvider,
    smtpHost: user.smtpHost,
    smtpPort: user.smtpPort,
    smtpSecure: user.smtpSecure,
    smtpUser: user.smtpUser,
    smtpPassword: user.smtpPassword,
    senderEmail: user.senderEmail,
    senderName: user.senderName,
    signature: user.signature,
  });

  return NextResponse.json(result);
}
