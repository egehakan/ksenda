import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const maxDuration = 300;

// GET /api/settings — legacy shape kept as a thin shim over /api/auth/me +
// /api/users/me. New code should use those endpoints directly.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({
      settings: {
        id: 'default',
        senderEmail: user.senderEmail,
        senderName: user.senderName,
        signature: user.signature,
      },
      envFallback: { senderEmail: null },
      userEmail: user.email,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/settings — legacy shape: writes the email-related fields back into User.
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { senderEmail, senderName, signature } = body;

    if (senderEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(senderEmail)) {
        return NextResponse.json(
          { error: 'Invalid sender email address format' },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        senderEmail: senderEmail || null,
        senderName: senderName || null,
        ...(signature !== undefined && { signature: signature || null }),
      },
    });

    return NextResponse.json({
      settings: {
        id: 'default',
        senderEmail: updated.senderEmail,
        senderName: updated.senderName,
        signature: updated.signature,
      },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
