import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { PIPELINE_STATES } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const company = await prisma.company.findFirst({
      where: { id, userId: user.id },
      include: { email: true },
    });

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    if (!company.email) {
      return NextResponse.json({ error: 'No email found for this company' }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.email.delete({ where: { id: company.email.id } }),
      prisma.company.update({
        where: { id },
        data: { pipelineState: PIPELINE_STATES.PENDING_GENERATION },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          entityType: 'email',
          entityId: id,
          action: 'email_deleted',
          fromState: company.pipelineState,
          toState: PIPELINE_STATES.PENDING_GENERATION,
          metadata: { emailId: company.email.id },
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting email:', error);
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
  }
}
