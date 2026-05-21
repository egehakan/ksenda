/**
 * POST /api/emails/[id]/mark-sent
 *
 * Single-row LinkedIn manual-send. The :id is the Email row id. We resolve
 * the companyId from it and delegate to markInitialEmailAsSent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markInitialEmailAsSent } from "@/lib/services/email-sender";
import prisma from "@/lib/prisma";

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const email = await prisma.email.findUnique({
      where: { id },
      include: { company: { select: { userId: true } } },
    });
    if (!email || email.company.userId !== user.id) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    const res = await markInitialEmailAsSent(user.id, email.companyId, user.email);
    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/emails/[id]/mark-sent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
