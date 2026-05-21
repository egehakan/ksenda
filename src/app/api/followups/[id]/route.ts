import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/followups/[id] — edit a generated follow-up's subject/body
 * before approval/send. Mirrors the /api/emails/[id]/review path for the
 * initial cold-email flow.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { editedSubject, editedBody, approve } = body || {};

    const followUp = await prisma.followUpEmail.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!followUp || followUp.company.userId !== user.id) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }

    const data: any = { reviewedAt: new Date(), reviewedBy: user.email };
    if (editedSubject !== undefined) data.editedSubject = editedSubject;
    if (editedBody !== undefined) data.editedBody = editedBody;

    if (approve === true) {
      const finalSubject =
        editedSubject ?? followUp.editedSubject ?? followUp.subject;
      const finalBody = editedBody ?? followUp.editedBody ?? followUp.body;
      data.finalSubject = finalSubject;
      data.finalBody = finalBody;
      data.approvedAt = new Date();
      data.approvedBy = user.email;
    }

    const updated = await prisma.followUpEmail.update({
      where: { id },
      data,
    });

    return NextResponse.json({ followUp: updated });
  } catch (error) {
    console.error('PATCH /api/followups/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update follow-up' }, { status: 500 });
  }
}

/**
 * DELETE /api/followups/[id] — discard a generated follow-up without sending.
 * Does NOT reset the company's nextFollowUpAt, so the engine will try to
 * regenerate on the next /process run.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const followUp = await prisma.followUpEmail.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!followUp || followUp.company.userId !== user.id) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }
    if (followUp.sentAt) {
      return NextResponse.json(
        { error: 'Already sent — cannot delete.' },
        { status: 400 }
      );
    }

    await prisma.followUpEmail.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/followups/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete follow-up' }, { status: 500 });
  }
}
