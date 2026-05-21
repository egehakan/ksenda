import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { todayKey } from '@/lib/services/campaign';

export const maxDuration = 300;

/**
 * POST /api/automation/ai-setup/auto-fill — round-robins the chosen
 * recipes across the next 30 days starting from `startDate`, respecting
 * the cadence (weekdays / Mon-Wed-Fri / Tue-Thu). Weekends and off-days
 * become skip rows so the calendar still shows the rhythm.
 *
 * Body: {
 *   startDate: "YYYY-MM-DD",
 *   cadence: "daily" | "alt" | "light",
 *   recipeIds: string[],
 *   preservePast?: boolean   (default true)
 * }
 *
 * Cadence semantics:
 *   - "daily"  — every weekday (5/week, ~22 runs in 30 days)
 *   - "alt"    — Mon/Wed/Fri (3/week, ~13 runs in 30 days)
 *   - "light"  — Tue/Thu (2/week, ~8 runs in 30 days)
 */

type Cadence = 'daily' | 'alt' | 'light';

const CADENCE_DOWS: Record<Cadence, number[]> = {
  // 1=Mon … 5=Fri (UTC getUTCDay convention)
  daily: [1, 2, 3, 4, 5],
  alt: [1, 3, 5],
  light: [2, 4],
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const startDate = typeof body?.startDate === 'string' ? body.startDate : '';
    const cadence: Cadence =
      body?.cadence === 'alt' || body?.cadence === 'light' ? body.cadence : 'daily';
    const recipeIds = Array.isArray(body?.recipeIds) ? body.recipeIds : [];
    const preservePast = body?.preservePast !== false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json(
        { error: 'startDate is required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }
    if (recipeIds.length === 0) {
      return NextResponse.json(
        { error: 'recipeIds must contain at least one recipe' },
        { status: 400 }
      );
    }

    // Verify recipe ownership + load defaults. We re-fetch in order so
    // the user-selected sequence is preserved for round-robin.
    const owned = await prisma.savedSearch.findMany({
      where: { userId: user.id, id: { in: recipeIds } },
      select: {
        id: true,
        code: true,
        name: true,
        defaultDailyCap: true,
        channel: true,
      },
    });
    type OwnedRecipe = (typeof owned)[number];
    const byId = new Map<string, OwnedRecipe>(owned.map((r) => [r.id, r]));
    const recipes: OwnedRecipe[] = (recipeIds as unknown[])
      .map((id) => (typeof id === 'string' ? byId.get(id) : undefined))
      .filter((r): r is OwnedRecipe => r !== undefined);
    if (recipes.length === 0) {
      return NextResponse.json(
        { error: 'No matching recipes found for the current user' },
        { status: 404 }
      );
    }

    // Split the recipes by channel so each channel cycles through its own
    // pool independently. When both pools are non-empty, every active day
    // gets one row per channel (= up to 2 CampaignDay rows per date — the
    // (userId, scheduledDate, channel) unique constraint allows this).
    const emailRecipes = recipes.filter((r) => r.channel !== 'linkedin');
    const linkedinRecipes = recipes.filter((r) => r.channel === 'linkedin');
    const channelPools: Array<{ channel: 'email' | 'linkedin'; pool: OwnedRecipe[] }> = [];
    if (emailRecipes.length > 0) channelPools.push({ channel: 'email', pool: emailRecipes });
    if (linkedinRecipes.length > 0)
      channelPools.push({ channel: 'linkedin', pool: linkedinRecipes });

    const today = todayKey();
    const wipeFrom = preservePast && startDate < today ? today : startDate;
    // Only wipe the channels this run is going to refill. If the user
    // already has email days set up and now runs Smart Setup with LinkedIn
    // only, the email schedule stays put and LinkedIn rows are added
    // alongside — they're independent channels with their own unique slot
    // per (userId, scheduledDate, channel).
    const wipeChannels = channelPools.map((p) => p.channel);
    await prisma.campaignDay.deleteMany({
      where: {
        userId: user.id,
        scheduledDate: { gte: wipeFrom },
        channel: { in: wipeChannels },
      },
    });
    // The other channel's row count — used to inform the response copy so
    // the wizard can say "added alongside your existing X schedule".
    const otherChannels: Array<'email' | 'linkedin'> = (
      ['email', 'linkedin'] as const
    ).filter((c) => !wipeChannels.includes(c));
    const preservedOtherChannel =
      otherChannels.length > 0
        ? await prisma.campaignDay.count({
            where: {
              userId: user.id,
              scheduledDate: { gte: wipeFrom },
              channel: { in: otherChannels },
              status: 'scheduled',
            },
          })
        : 0;

    const allowDows = new Set(CADENCE_DOWS[cadence]);
    const start = parseDateKey(startDate);
    // Independent rotation cursors per channel — keeps the round-robin
    // distribution even when one channel has more recipes than the other.
    const channelCursors: Record<'email' | 'linkedin', number> = {
      email: 0,
      linkedin: 0,
    };
    // Skip rows (weekends + off-days) need to belong to a channel — the
    // CampaignDay schema requires it for the (userId, date, channel) unique
    // key. Pick the FIRST channel being filled so we don't try to insert
    // skip rows into a channel slot we're not touching (which would either
    // collide with a preserved row or pollute the unused slot).
    const skipChannel = channelPools[0].channel;
    let scheduledCount = 0;
    let skippedCount = 0;
    let firstScheduledDate = '';
    let lastScheduledDate = '';

    for (let i = 0; i < 30; i++) {
      const d = addDaysUtc(start, i);
      const dateKey = toDateKey(d);
      const dow = d.getUTCDay();

      // Preserving past — leave existing rows untouched.
      if (preservePast && dateKey < today) continue;

      // Weekends: always skip-row so the calendar shows the gap. One skip
      // row per date is enough regardless of channel mix; the calendar UI
      // collapses skip rows into a single "Weekend" tile. The row goes on
      // the channel we're currently filling so we don't collide with any
      // preserved other-channel row on this date.
      if (dow === 0 || dow === 6) {
        await prisma.campaignDay.create({
          data: {
            userId: user.id,
            scheduledDate: dateKey,
            savedSearchId: null,
            dailyImportCap: 0,
            dailySendCap: 0,
            focusNote: 'Weekend — no outbound.',
            status: 'skipped',
            channel: skipChannel,
          },
        });
        skippedCount++;
        continue;
      }

      // Off-days for the chosen cadence: also skip-row.
      if (!allowDows.has(dow)) {
        await prisma.campaignDay.create({
          data: {
            userId: user.id,
            scheduledDate: dateKey,
            savedSearchId: null,
            dailyImportCap: 0,
            dailySendCap: 0,
            focusNote: 'Off-day — paced cadence.',
            status: 'skipped',
            channel: skipChannel,
          },
        });
        skippedCount++;
        continue;
      }

      // Active day — one row per non-empty channel pool, each round-
      // robining through its own recipe list.
      let scheduledOnDay = false;
      for (const { channel, pool } of channelPools) {
        const recipe = pool[channelCursors[channel] % pool.length];
        channelCursors[channel]++;
        await prisma.campaignDay.create({
          data: {
            userId: user.id,
            scheduledDate: dateKey,
            savedSearchId: recipe.id,
            dailyImportCap: recipe.defaultDailyCap,
            dailySendCap: recipe.defaultDailyCap,
            focusNote: `${recipe.code} · ${recipe.name}`,
            status: 'scheduled',
            channel,
          },
        });
        scheduledOnDay = true;
      }
      if (scheduledOnDay) {
        scheduledCount++;
        if (!firstScheduledDate) firstScheduledDate = dateKey;
        lastScheduledDate = dateKey;
      }
    }

    return NextResponse.json({
      success: true,
      scheduledCount,
      skippedCount,
      firstScheduledDate,
      lastScheduledDate,
      cadence,
      filledChannels: wipeChannels,
      preservedOtherChannelDays: preservedOtherChannel,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('POST /api/automation/ai-setup/auto-fill error:', error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// UTC-anchored date math (duplicated locally to keep this route self-
// contained; the campaign service has the same helpers).

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysUtc(base: Date, n: number): Date {
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n)
  );
}
