import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const maxDuration = 300;

const ALLOWED_PROVIDERS = new Set(["gmail", "outlook", "custom"]);

interface PatchBody {
  name?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  apolloApiKey?: string | null;
  geminiApiKey?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  signature?: string | null;
  smtpProvider?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
}

const SECRET_KEYS = new Set(["apolloApiKey", "geminiApiKey", "smtpPassword"]);

export async function GET() {
  return Response.json({ note: "Use /api/auth/me to read your profile" }, { status: 200 });
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as PatchBody;

    if (body.smtpProvider && !ALLOWED_PROVIDERS.has(body.smtpProvider)) {
      return NextResponse.json(
        { error: `Invalid smtpProvider. Must be one of: ${[...ALLOWED_PROVIDERS].join(", ")}` },
        { status: 400 }
      );
    }
    if (body.senderEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.senderEmail)) {
        return NextResponse.json({ error: "Invalid sender email" }, { status: 400 });
      }
    }
    if (body.companyWebsite) {
      try {
        const url = body.companyWebsite.startsWith("http")
          ? body.companyWebsite
          : `https://${body.companyWebsite}`;
        new URL(url);
      } catch {
        return NextResponse.json({ error: "Invalid company website URL" }, { status: 400 });
      }
    }

    // Build update data — only include keys that are actually present in the
    // request payload. Secret fields with empty strings are coerced to NULL so
    // a user can clear a key from the UI; secret fields that are undefined are
    // left untouched (so the UI never has to re-submit existing keys).
    const data: Record<string, unknown> = {};
    const writableFields: Array<keyof PatchBody> = [
      "name",
      "companyName",
      "companyWebsite",
      "apolloApiKey",
      "geminiApiKey",
      "senderEmail",
      "senderName",
      "signature",
      "smtpProvider",
      "smtpHost",
      "smtpPort",
      "smtpSecure",
      "smtpUser",
      "smtpPassword",
    ];
    for (const k of writableFields) {
      if (!(k in body)) continue;
      const v = body[k];
      if (SECRET_KEYS.has(k as string)) {
        // Empty string => clear; null => clear; non-empty => set; undefined => skip
        if (v === undefined) continue;
        if (v === null || (typeof v === "string" && v.trim() === "")) {
          data[k] = null;
        } else {
          data[k] = v;
        }
      } else {
        data[k] =
          v === undefined
            ? undefined
            : v === null
            ? null
            : typeof v === "string"
            ? v.trim() || null
            : v;
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        companyName: updated.companyName,
        companyWebsite: updated.companyWebsite,
        senderEmail: updated.senderEmail,
        senderName: updated.senderName,
        signature: updated.signature,
        smtpProvider: updated.smtpProvider,
        smtpHost: updated.smtpHost,
        smtpPort: updated.smtpPort,
        smtpSecure: updated.smtpSecure,
        smtpUser: updated.smtpUser,
        hasApolloKey: !!updated.apolloApiKey,
        hasGeminiKey: !!updated.geminiApiKey,
        hasSmtpPassword: !!updated.smtpPassword,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
