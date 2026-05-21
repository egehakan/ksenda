import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sendApprovedFollowUp } from '@/lib/services/followup';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/followups/[id]/send — send a previously approved follow-up
 * through the user's SMTP, threaded as a reply to the original cold email.
 *
 * Body: { recipientEmail: string, senderEmail?: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { recipientEmail, senderEmail } = body || {};
    if (!recipientEmail) {
      return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    }

    const result = await sendApprovedFollowUp(
      user.id,
      id,
      recipientEmail,
      user.email,
      senderEmail
    );
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/followups/[id]/send error:', error);
    return NextResponse.json({ error: 'Failed to send follow-up' }, { status: 500 });
  }
}
