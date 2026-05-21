import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { transitionState } from '@/lib/services/pipeline';
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
    const body = await request.json().catch(() => ({}));
    const { approvedBy } = body;

    const email = await prisma.email.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    if (email.company.userId !== user.id) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (email.company.pipelineState !== PIPELINE_STATES.PENDING_REVIEW) {
      return NextResponse.json(
        { error: 'Email must be in pending_review state to approve' },
        { status: 400 }
      );
    }

    const finalSubject = email.editedSubject || email.subject;
    const finalBody = email.editedBody || email.body;

    await prisma.email.update({
      where: { id },
      data: {
        finalSubject,
        finalBody,
        approvedAt: new Date(),
        approvedBy: approvedBy || user.email,
      },
    });

    const result = await transitionState(
      user.id,
      email.companyId,
      PIPELINE_STATES.APPROVED_TO_SEND,
      approvedBy || user.email
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: 'email',
        entityId: id,
        action: 'email_approved',
        metadata: { approvedBy: approvedBy || user.email },
      },
    });

    // Auto-send hook. No-op unless autoSendApprovedEmails is on AND we're
    // in the send window AND under the daily cap.
    const { onEmailApproved } = await import('@/lib/services/automation');
    const auto = await onEmailApproved(user.id, email.companyId);

    return NextResponse.json({ success: true, autoSent: auto.sent });
  } catch (error) {
    console.error('Error approving email:', error);
    return NextResponse.json({ error: 'Failed to approve email' }, { status: 500 });
  }
}
