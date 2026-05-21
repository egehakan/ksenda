import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * PATCH /api/automation/schedule/[date] — override a single scheduled day.
 *
 * Body: any of { savedSearchId, dailyImportCap, dailySendCap, focusNote, status, channel }
 *   status can be "scheduled" or "skipped" — flipping a day to skipped
 *   short-circuits the orchestrator for that date.
 *   channel is "email" | "linkedin" (default "email"). With the 0012
 *   migration, the CampaignDay unique key is (userId, scheduledDate, channel)
 *   so two rows can coexist on the same date — one per channel. PATCH
 *   targets the channel-specific row.
 *
 * Server-side rule: when a savedSearchId is supplied, we derive `channel`
 * from the recipe so the row is always consistent with its recipe.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (typeof body.savedSearchId === 'string' || body.savedSearchId === null) {
      data.savedSearchId = body.savedSearchId;
    }
    if (typeof body.dailyImportCap === 'number') data.dailyImportCap = body.dailyImportCap;
    if (typeof body.dailySendCap === 'number') data.dailySendCap = body.dailySendCap;
    if (typeof body.focusNote === 'string') data.focusNote = body.focusNote;
    if (body.status === 'scheduled' || body.status === 'skipped' || body.status === 'completed') {
      data.status = body.status;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Resolve the channel for this row. Priority: explicit body.channel >
    // the recipe's own channel (derived server-side from savedSearchId) >
    // 'email'. The recipe-side derivation is what the calendar UI relies on
    // — the client passes the picked recipe's channel and we don't trust
    // it blindly.
    let channel: 'email' | 'linkedin' =
      body.channel === 'linkedin' ? 'linkedin' : 'email';

    if (typeof data.savedSearchId === 'string') {
      const owned = await prisma.savedSearch.findFirst({
        where: { id: data.savedSearchId, userId: user.id },
        select: { id: true, channel: true },
      });
      if (!owned) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
      }
      // The recipe is the source of truth for channel — override whatever
      // the client claimed.
      channel = owned.channel === 'linkedin' ? 'linkedin' : 'email';
    }
    data.channel = channel;

    // Upsert by the compound (userId, scheduledDate, channel) unique key.
    const updated = await prisma.campaignDay.upsert({
      where: {
        userId_scheduledDate_channel: {
          userId: user.id,
          scheduledDate: date,
          channel,
        },
      },
      update: data,
      create: {
        userId: user.id,
        scheduledDate: date,
        channel,
        savedSearchId: (data.savedSearchId as string) ?? null,
        dailyImportCap:
          (data.dailyImportCap as number) ?? (channel === 'linkedin' ? 15 : 25),
        dailySendCap:
          (data.dailySendCap as number) ?? (channel === 'linkedin' ? 15 : 25),
        focusNote: (data.focusNote as string) ?? null,
        status: (data.status as string) ?? 'scheduled',
      },
    });

    return NextResponse.json({ day: updated });
  } catch (error) {
    console.error('PATCH /api/automation/schedule/[date] error:', error);
    return NextResponse.json({ error: 'Failed to update day' }, { status: 500 });
  }
}

/**
 * DELETE /api/automation/schedule/[date] — remove CampaignDay row(s) on
 * this date. With ?channel=email|linkedin: drops only that channel's row.
 * Without: drops every row for the date (every channel).
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const channelParam = request.nextUrl.searchParams.get('channel');
    const channel: 'email' | 'linkedin' | null =
      channelParam === 'email' || channelParam === 'linkedin' ? channelParam : null;

    await prisma.campaignDay.deleteMany({
      where: {
        userId: user.id,
        scheduledDate: date,
        ...(channel ? { channel } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/automation/schedule/[date] error:', error);
    return NextResponse.json({ error: 'Failed to delete day' }, { status: 500 });
  }
}
