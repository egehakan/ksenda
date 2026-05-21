/**
 * Campaign schedule service.
 *
 * Materializes the 30-day plan from PLAN_22 into CampaignDay rows starting
 * at a chosen date. Weekends are inserted automatically as skip days.
 * Re-generation wipes future days, keeps past days (so the retrospective
 * record stays intact).
 *
 * Today's CampaignDay drives the orchestrator's auto-import recipe — the
 * single-saved-search field on User becomes a fallback only.
 */
import prisma from '@/lib/prisma';
import { PLAN_22, NON_AI_PLAN_22, type PlanPosition } from '@/lib/campaign-recipes';

/** YYYY-MM-DD in UTC. Same shape we store in CampaignDay.scheduledDate. */
export function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

function addDaysUtc(base: Date, n: number): Date {
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + n
    )
  );
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export interface GenerateOptions {
  startDate: string; // YYYY-MM-DD
  /**
   * When true, preserves CampaignDay rows whose scheduledDate is strictly
   * before todayKey() — those represent runs already executed. Default
   * behavior per the design ("wipe future, keep past").
   */
  preservePast?: boolean;
  /**
   * Which plan to materialize. "ai" (default) = PLAN_22 targeting AI-native
   * Series-A/B startups. "non_ai" = NON_AI_PLAN_22 targeting traditional
   * companies that don't yet use AI, for the second outbound stream.
   * Direct PlanPosition[] is supported as an escape hatch for custom plans.
   */
  plan?: 'ai' | 'non_ai' | PlanPosition[];
}

export interface GenerateResult {
  inserted: number;
  skippedDays: number;
  totalDays: 30;
  scheduledFirstDate: string;
  scheduledLastDate: string;
}

/**
 * Build the 30-day schedule for a user. Walks 30 calendar days from
 * startDate; for each day:
 *   - Weekend → skip day, status=skipped
 *   - Otherwise consume the next PLAN_22 position. If position is AUDIT,
 *     status=skipped with focusNote="Day 30 audit ...". Otherwise look up
 *     the SavedSearch by code and pin recipe + cap.
 */
export async function generateSchedule(
  userId: string,
  opts: GenerateOptions
): Promise<GenerateResult> {
  const start = parseDateKey(opts.startDate);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid startDate');
  }

  const preservePast = opts.preservePast !== false;
  const today = todayKey();

  // Resolve which plan to walk. Default keeps the original AI-native PLAN_22.
  const planPositions: PlanPosition[] =
    Array.isArray(opts.plan)
      ? opts.plan
      : opts.plan === 'non_ai'
      ? NON_AI_PLAN_22
      : PLAN_22;

  // Wipe existing rows ≥ today (or ≥ start, whichever is later).
  const wipeFrom = preservePast && opts.startDate < today ? today : opts.startDate;
  await prisma.campaignDay.deleteMany({
    where: { userId, scheduledDate: { gte: wipeFrom } },
  });

  // Resolve the user's recipes once. We index by code.
  const recipes = await prisma.savedSearch.findMany({
    where: { userId },
    select: { id: true, code: true, defaultDailyCap: true },
  });
  const byCode = new Map(recipes.map((r) => [r.code, r]));

  let planIdx = 0;
  let inserted = 0;
  let skippedDays = 0;
  let scheduledFirstDate = '';
  let scheduledLastDate = '';

  for (let i = 0; i < 30; i++) {
    const date = addDaysUtc(start, i);
    const dow = date.getUTCDay(); // 0=Sun, 6=Sat
    const key = toDateKey(date);

    // If this day is in the past and we're preserving, skip insertion.
    if (preservePast && key < today) {
      continue;
    }

    if (dow === 0 || dow === 6) {
      await prisma.campaignDay.create({
        data: {
          userId,
          scheduledDate: key,
          savedSearchId: null,
          dailyImportCap: 0,
          dailySendCap: 0,
          focusNote: 'Weekend — no send for deliverability.',
          status: 'skipped',
        },
      });
      skippedDays++;
      continue;
    }

    if (planIdx >= planPositions.length) {
      // Past the plan's 22 working days — buffer skip.
      await prisma.campaignDay.create({
        data: {
          userId,
          scheduledDate: key,
          savedSearchId: null,
          dailyImportCap: 0,
          dailySendCap: 0,
          focusNote: 'Plan complete. Generate a new schedule to continue.',
          status: 'skipped',
        },
      });
      skippedDays++;
      continue;
    }

    const pos = planPositions[planIdx];
    planIdx++;

    if (pos.code === 'AUDIT') {
      await prisma.campaignDay.create({
        data: {
          userId,
          scheduledDate: key,
          savedSearchId: null,
          dailyImportCap: 0,
          dailySendCap: 0,
          focusNote: pos.focusNote,
          status: 'skipped',
        },
      });
      skippedDays++;
      continue;
    }

    const recipe = byCode.get(pos.code);
    await prisma.campaignDay.create({
      data: {
        userId,
        scheduledDate: key,
        savedSearchId: recipe?.id ?? null,
        dailyImportCap: pos.cap,
        dailySendCap: pos.cap,
        focusNote: pos.focusNote,
        status: 'scheduled',
      },
    });
    inserted++;
    if (!scheduledFirstDate) scheduledFirstDate = key;
    scheduledLastDate = key;
  }

  return {
    inserted,
    skippedDays,
    totalDays: 30,
    scheduledFirstDate,
    scheduledLastDate,
  };
}

/**
 * Find today's CampaignDay rows for a user. With the 0012 migration, a
 * single date can carry up to two rows — one per channel (email + linkedin).
 * Empty array = nothing scheduled (the orchestrator falls back to the
 * single saved search in that case).
 *
 * Rows are returned email-first then linkedin so downstream iteration is
 * deterministic.
 */
export async function getTodaysCampaignDays(userId: string) {
  const rows = await prisma.campaignDay.findMany({
    where: { userId, scheduledDate: todayKey() },
    include: { savedSearch: true },
  });
  rows.sort((a, b) =>
    a.channel === 'email' ? -1 : b.channel === 'email' ? 1 : 0
  );
  return rows;
}

/**
 * @deprecated Use `getTodaysCampaignDays` — a date can now carry up to two
 * rows (one per channel). This wrapper returns the email row (or the first
 * row if no email row exists) for legacy callers.
 */
export async function getTodaysCampaignDay(userId: string) {
  const rows = await getTodaysCampaignDays(userId);
  return rows[0] ?? null;
}
