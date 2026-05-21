import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateSchedule } from '@/lib/services/campaign';

export const maxDuration = 300;

/**
 * POST /api/automation/schedule/generate — build a 30-day campaign
 * schedule starting at `startDate`. Default behavior: preserve past
 * CampaignDay rows (history stays for the retrospective), wipe future
 * days from today onward and re-seed.
 *
 * Body: { startDate: "YYYY-MM-DD", preservePast?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { startDate, preservePast } = body || {};
    if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json(
        { error: 'startDate is required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const result = await generateSchedule(user.id, {
      startDate,
      preservePast: preservePast !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('POST /api/automation/schedule/generate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generate failed' },
      { status: 500 }
    );
  }
}
