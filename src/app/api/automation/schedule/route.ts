import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { todayKey } from '@/lib/services/campaign';

export const maxDuration = 300;

/**
 * GET /api/automation/schedule — list CampaignDay rows for the current user.
 *
 * Query params:
 *   ?from=YYYY-MM-DD  (default: today)
 *   ?to=YYYY-MM-DD    (default: today + 30 days)
 *   ?includePast=1    (include days before today)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const includePast = url.searchParams.get('includePast') === '1';
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    const todayStr = todayKey();
    const from = fromParam ?? (includePast ? '0000-01-01' : todayStr);
    const to = toParam ?? '9999-12-31';

    const days = await prisma.campaignDay.findMany({
      where: {
        userId: user.id,
        scheduledDate: { gte: from, lte: to },
      },
      include: { savedSearch: true },
      orderBy: { scheduledDate: 'asc' },
    });

    return NextResponse.json({
      days,
      today: todayStr,
    });
  } catch (error) {
    console.error('GET /api/automation/schedule error:', error);
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
  }
}
