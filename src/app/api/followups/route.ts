import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET /api/followups — list follow-up emails for the current user.
 *
 * Query params:
 *   ?status=pending|sent  (pending = sentAt is null, sent = sentAt set)
 *   ?step=1|2|3
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const stepParam = url.searchParams.get('step');

    const where: any = { company: { userId: user.id } };
    if (status === 'pending') where.sentAt = null;
    if (status === 'sent') where.sentAt = { not: null };
    if (stepParam) {
      const s = parseInt(stepParam, 10);
      if (Number.isInteger(s)) where.step = s;
    }

    const followUps = await prisma.followUpEmail.findMany({
      where,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            domain: true,
            website: true,
            targetContactFirstName: true,
            targetContactLastName: true,
            targetContactEmail: true,
            targetContactTitle: true,
            clientStatus: true,
          },
        },
      },
      orderBy: [{ generatedAt: 'desc' }],
    });

    return NextResponse.json({ followUps });
  } catch (error) {
    console.error('GET /api/followups error:', error);
    return NextResponse.json({ error: 'Failed to list follow-ups' }, { status: 500 });
  }
}
