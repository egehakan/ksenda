import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendApprovedEmail } from '@/lib/services/email-sender';
import { PIPELINE_STATES } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { recipientEmail, performedBy, senderEmail } = body;

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email is required' },
        { status: 400 }
      );
    }

    const email = await prisma.email.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!email || email.company.userId !== user.id) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (email.company.pipelineState !== PIPELINE_STATES.APPROVED_TO_SEND) {
      return NextResponse.json(
        { error: 'Email must be approved before sending' },
        { status: 400 }
      );
    }

    const result = await sendApprovedEmail(
      user.id,
      email.companyId,
      recipientEmail,
      performedBy || user.email,
      senderEmail
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
