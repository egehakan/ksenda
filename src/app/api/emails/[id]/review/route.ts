import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const email = await prisma.email.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!email || email.company.userId !== user.id) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    return NextResponse.json({ email });
  } catch (error) {
    console.error('Error fetching email for review:', error);
    return NextResponse.json({ error: 'Failed to fetch email' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { editedSubject, editedBody, reviewedBy, recipientEmail } = body;

    const email = await prisma.email.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!email || email.company.userId !== user.id) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (!editedSubject?.trim() || !editedBody?.trim()) {
      return NextResponse.json(
        { error: 'Subject and body are required' },
        { status: 400 }
      );
    }

    await prisma.email.update({
      where: { id },
      data: {
        editedSubject: editedSubject.trim(),
        editedBody: editedBody.trim(),
        ...(email.company.pipelineState === 'approved_to_send' && {
          finalSubject: editedSubject.trim(),
          finalBody: editedBody.trim(),
        }),
        reviewedAt: new Date(),
        reviewedBy: reviewedBy || user.email,
      },
    });

    if (recipientEmail?.trim()) {
      await prisma.company.update({
        where: { id: email.companyId },
        data: { targetContactEmail: recipientEmail.trim() },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: 'email',
        entityId: id,
        action: 'email_reviewed',
        metadata: {
          editedSubject: editedSubject !== email.subject,
          editedBody: editedBody !== email.body,
          recipientEmailChanged: !!recipientEmail,
          reviewedBy: reviewedBy || user.email,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting review:', error);
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }
}
