/**
 * Automation engine.
 *
 * Five independent toggles on the User row collapse one stage of the
 * cold-email pipeline each:
 *
 *   autoImportEnabled         — run a saved search + import on demand
 *   autoApproveInitialDrafts  — generated email skips pending_review
 *   autoSendApprovedEmails    — approved_to_send → sent automatically
 *   autoGenerateFollowUps     — run follow-up engine without manual button
 *   autoApproveFollowUps      — generated follow-up → auto-send
 *
 * Each toggle is honored regardless of how its stage was triggered — manual
 * UI click or scheduled orchestrator — so behavior is consistent across
 * entry points. The orchestrator (orchestrateRun) chains every enabled
 * stage in order, respecting the daily-cap and working-hours safety rails.
 *
 * Default behavior with all toggles off is exactly the existing review-first
 * product. No new code path runs unless the user opts in.
 */
import prisma from '@/lib/prisma';
import type { User } from '@/generated/prisma';
import { PIPELINE_STATES } from '@/lib/constants';
import { transitionState } from './pipeline';
import { sendApprovedEmail } from './email-sender';
import {
  generateNextFollowUp,
  processDueFollowUps,
  sendApprovedFollowUp,
} from './followup';
import { findBestContact } from './apollo';
import { getTodaysCampaignDays } from './campaign';

export interface AutomationConfig {
  autoImportEnabled: boolean;
  autoApproveInitialDrafts: boolean;
  autoSendApprovedEmails: boolean;
  autoGenerateFollowUps: boolean;
  autoApproveFollowUps: boolean;
  dailyImportCap: number;
  dailySendCap: number;
  windowStartHour: number;
  windowEndHour: number;
  timezone: string;
  savedSearchKind: 'companies' | 'people' | null;
  savedSearchFilters: Record<string, unknown> | null;
}

export function loadConfig(user: User): AutomationConfig {
  let filters: Record<string, unknown> | null = null;
  if (user.savedSearchFiltersJson) {
    try {
      filters = JSON.parse(user.savedSearchFiltersJson);
    } catch {
      filters = null;
    }
  }
  return {
    autoImportEnabled: !!user.autoImportEnabled,
    autoApproveInitialDrafts: !!user.autoApproveInitialDrafts,
    autoSendApprovedEmails: !!user.autoSendApprovedEmails,
    autoGenerateFollowUps: !!user.autoGenerateFollowUps,
    autoApproveFollowUps: !!user.autoApproveFollowUps,
    dailyImportCap: user.dailyImportCap ?? 25,
    dailySendCap: user.dailySendCap ?? 25,
    windowStartHour: user.automationWindowStartHour ?? 9,
    windowEndHour: user.automationWindowEndHour ?? 17,
    timezone: user.automationTimezone || 'Europe/Istanbul',
    savedSearchKind:
      (user.savedSearchKind as 'companies' | 'people' | null) || null,
    savedSearchFilters: filters,
  };
}

/**
 * Check if "now" falls inside the user's auto-send working-hours window in
 * their configured IANA timezone. Out-of-window means auto-SEND stages
 * (initial and follow-up) are skipped; generation/import can still run.
 */
export function isInSendWindow(config: AutomationConfig, now: Date = new Date()): boolean {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: config.timezone,
    });
    const hour = parseInt(fmt.format(now), 10);
    return hour >= config.windowStartHour && hour < config.windowEndHour;
  } catch {
    // Bad timezone → fail open. Better to send than drop a queued email.
    return true;
  }
}

/** Count of initial emails sent by `userId` since UTC start-of-day. */
async function sendsTodayInitial(userId: string): Promise<number> {
  const since = startOfTodayUtc();
  return prisma.email.count({
    where: { company: { userId }, sentAt: { gte: since } },
  });
}

/** Count of follow-up emails sent by `userId` since UTC start-of-day. */
async function sendsTodayFollowUp(userId: string): Promise<number> {
  const since = startOfTodayUtc();
  return prisma.followUpEmail.count({
    where: { company: { userId }, sentAt: { gte: since } },
  });
}

/** Combined send count (initial + follow-up) since UTC start-of-day. */
async function sendsToday(userId: string): Promise<number> {
  const [a, b] = await Promise.all([
    sendsTodayInitial(userId),
    sendsTodayFollowUp(userId),
  ]);
  return a + b;
}

/** Count of companies imported by `userId` since UTC start-of-day. */
async function importsToday(userId: string): Promise<number> {
  const since = startOfTodayUtc();
  return prisma.company.count({
    where: { userId, createdAt: { gte: since } },
  });
}

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ────────────────────────────────────────────────────────────────────────
// Auto-progression hooks. Called from existing flows after each lifecycle
// transition. Each is a no-op unless the matching toggle is on.
// ────────────────────────────────────────────────────────────────────────

/**
 * After an initial Email has just been generated (Company now in
 * `pending_review`), if `autoApproveInitialDrafts` is on, mark it approved.
 * If `autoSendApprovedEmails` is also on, send it immediately.
 *
 * Called from /api/companies/import and the regenerate flow. Idempotent.
 */
export async function onInitialEmailGenerated(
  userId: string,
  companyId: string
): Promise<{ approved: boolean; sent: boolean; sendError?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { approved: false, sent: false };
  const config = loadConfig(user);
  if (!config.autoApproveInitialDrafts) return { approved: false, sent: false };

  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
    include: { email: true },
  });
  if (!company?.email) return { approved: false, sent: false };
  if (company.pipelineState !== PIPELINE_STATES.PENDING_REVIEW) {
    return { approved: false, sent: false };
  }

  // 1) Approve. Stamps approval metadata + transitions the state.
  const finalSubject =
    company.email.editedSubject || company.email.subject;
  const finalBody = company.email.editedBody || company.email.body;
  await prisma.email.update({
    where: { id: company.email.id },
    data: {
      approvedAt: new Date(),
      approvedBy: `auto:${user.email}`,
      finalSubject,
      finalBody,
    },
  });
  await transitionState(
    userId,
    companyId,
    PIPELINE_STATES.APPROVED_TO_SEND,
    `auto:${user.email}`,
    { reason: 'autoApproveInitialDrafts' }
  );

  // 2) Optionally send. Respect the daily cap and the work-hours window.
  if (!config.autoSendApprovedEmails) {
    return { approved: true, sent: false };
  }
  if (!isInSendWindow(config)) {
    return { approved: true, sent: false, sendError: 'outside_send_window' };
  }
  const used = await sendsToday(userId);
  if (used >= config.dailySendCap) {
    return { approved: true, sent: false, sendError: 'daily_send_cap_reached' };
  }
  if (!company.targetContactEmail) {
    return { approved: true, sent: false, sendError: 'no_recipient_email' };
  }
  const send = await sendApprovedEmail(
    userId,
    companyId,
    company.targetContactEmail,
    `auto:${user.email}`
  );
  return {
    approved: true,
    sent: send.success,
    sendError: send.success ? undefined : send.error,
  };
}

/**
 * After a Company has been manually moved to approved_to_send (user clicked
 * Approve or batch-approve), if `autoSendApprovedEmails` is on, fire the
 * send immediately. No-op if the toggle is off or we're outside the
 * send window or over the daily cap.
 *
 * Called from /api/emails/[id]/approve and /api/pipeline/batch-approve.
 */
export async function onEmailApproved(
  userId: string,
  companyId: string
): Promise<{ sent: boolean; sendError?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sent: false };
  const config = loadConfig(user);
  if (!config.autoSendApprovedEmails) return { sent: false };

  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
  });
  if (!company) return { sent: false };
  if (company.pipelineState !== PIPELINE_STATES.APPROVED_TO_SEND) {
    return { sent: false };
  }
  if (!isInSendWindow(config)) {
    return { sent: false, sendError: 'outside_send_window' };
  }
  const used = await sendsToday(userId);
  if (used >= config.dailySendCap) {
    return { sent: false, sendError: 'daily_send_cap_reached' };
  }
  if (!company.targetContactEmail) {
    return { sent: false, sendError: 'no_recipient_email' };
  }
  const send = await sendApprovedEmail(
    userId,
    companyId,
    company.targetContactEmail,
    `auto:${user.email}`
  );
  return {
    sent: send.success,
    sendError: send.success ? undefined : send.error,
  };
}

/**
 * After a follow-up email has been generated (FollowUpEmail row created in
 * pending state), if `autoApproveFollowUps` is on, approve and send it.
 *
 * Called from generateNextFollowUp at the end of generation. Idempotent.
 */
export async function onFollowUpGenerated(
  userId: string,
  followUpEmailId: string
): Promise<{ approved: boolean; sent: boolean; sendError?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { approved: false, sent: false };
  const config = loadConfig(user);
  if (!config.autoApproveFollowUps) return { approved: false, sent: false };

  const fu = await prisma.followUpEmail.findUnique({
    where: { id: followUpEmailId },
    include: { company: true },
  });
  if (!fu || fu.company.userId !== userId) return { approved: false, sent: false };
  if (fu.sentAt) return { approved: false, sent: false };

  const finalSubject = fu.editedSubject || fu.subject;
  const finalBody = fu.editedBody || fu.body;
  await prisma.followUpEmail.update({
    where: { id: fu.id },
    data: {
      approvedAt: new Date(),
      approvedBy: `auto:${user.email}`,
      reviewedAt: new Date(),
      reviewedBy: `auto:${user.email}`,
      finalSubject,
      finalBody,
    },
  });

  if (!isInSendWindow(config)) {
    return { approved: true, sent: false, sendError: 'outside_send_window' };
  }
  const used = await sendsToday(userId);
  if (used >= config.dailySendCap) {
    return { approved: true, sent: false, sendError: 'daily_send_cap_reached' };
  }
  if (!fu.company.targetContactEmail) {
    return { approved: true, sent: false, sendError: 'no_recipient_email' };
  }

  const send = await sendApprovedFollowUp(
    userId,
    fu.id,
    fu.company.targetContactEmail,
    `auto:${user.email}`
  );
  return {
    approved: true,
    sent: send.success,
    sendError: send.success ? undefined : send.error,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator.
// ────────────────────────────────────────────────────────────────────────

export interface OrchestrationResult {
  ran: boolean;
  skippedReason?: string;
  importedCount: number;
  generatedFollowUpCount: number;
  approvedExistingDrafts: number;
  sentInitial: number;
  sentFollowUp: number;
  errors: Array<{ stage: string; detail: string }>;
}

/**
 * Single orchestration pass. Runs every enabled stage in order, respecting
 * caps and windows. Triggered from the "Run today" button OR (in the
 * future) a Vercel Cron.
 */
export async function orchestrateRun(userId: string): Promise<OrchestrationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return emptyResult({ ran: false, skippedReason: 'user_not_found' });
  }
  const config = loadConfig(user);

  // Surface progress to the UI. Child stages (import / followup_process)
  // create their own jobs too; the parent here is the user-visible "Running
  // today's plan" telemetry.
  const { createJob, updateJob, completeJob, failJob } = await import('./jobs');
  const parentJob = await createJob({
    userId,
    kind: 'automation_run',
    totalItems: 5,
    currentLabel: 'Starting automation run…',
  });

  // We no longer block the run when all toggles are off. A manually-triggered
  // run with a scheduled CampaignDay today is still useful — it imports +
  // generates and leaves the drafts in pending_review for the user to review.
  // The toggles only control whether the post-generation auto-progression
  // stages (approve, send, follow-up auto-send) fire.
  const result: OrchestrationResult = emptyResult({ ran: true });

  // STAGE 1 — Auto-import. If a CampaignDay exists for today, use its
  // recipe + caps (the 30-day calendar) — runs on a manual click whether
  // or not autoImportEnabled is flipped on. The toggle is reserved for
  // future Vercel-Cron scheduled runs. If no CampaignDay, fall back to
  // the user's single savedSearchFiltersJson (legacy path), gated by
  // autoImportEnabled. Each imported row triggers the usual generation
  // path, which honors auto-approve / auto-send via the post-gen hook.
  const todayDays = await getTodaysCampaignDays(userId);
  // A CampaignDay row in 'completed' state should still be runnable —
  // the user wants to be able to click Run today multiple times in a day
  // and have it import another full cap each click. 'skipped' days stay
  // blocked because the schedule explicitly marked them off.
  const usableDays = todayDays.filter(
    (d) =>
      (d.status === 'scheduled' || d.status === 'completed') &&
      !!d.savedSearch
  );
  const allSkipped =
    todayDays.length > 0 && todayDays.every((d) => d.status === 'skipped');
  const shouldRunImport =
    usableDays.length > 0 ? true : config.autoImportEnabled;

  await updateJob(parentJob, { processedItems: 0, currentLabel: 'Stage 1 / 5 · Importing today\'s recipe…' });

  if (shouldRunImport) {
    if (usableDays.length === 0 && allSkipped) {
      result.errors.push({
        stage: 'import',
        detail: `skipped_by_schedule: ${todayDays[0]?.focusNote || 'no recipe scheduled'}`,
      });
    } else if (usableDays.length > 0) {
      // Iterate each row for today (up to 2 — one per channel). Each row
      // runs its recipe + channel through runRecipeAndImport sequentially,
      // so Apollo/Gemini calls don't compete for the user's per-key rate
      // limit. dailyImportCap from each CampaignDay overrides the User-
      // level cap so the per-channel ramp works.
      for (const todayDay of usableDays) {
        const dayCap = todayDay.dailyImportCap;
        if (dayCap === 0) {
          result.errors.push({ stage: 'import', detail: 'daily_import_cap_reached' });
          continue;
        }
        try {
          let filters: Record<string, unknown> = {};
          try {
            filters = JSON.parse(todayDay.savedSearch!.filtersJson);
          } catch {
            /* invalid JSON — treated as empty filters */
          }
          const recipeAiFilter =
            (todayDay.savedSearch as unknown as { aiFilter?: string }).aiFilter ===
              'no_ai' ||
            (todayDay.savedSearch as unknown as { aiFilter?: string }).aiFilter ===
              'has_ai'
              ? ((todayDay.savedSearch as unknown as { aiFilter: 'no_ai' | 'has_ai' })
                  .aiFilter)
              : 'any';
          const channel: 'email' | 'linkedin' =
            todayDay.channel === 'linkedin' ? 'linkedin' : 'email';
          const runOutcome = await runRecipeAndImport(
            user,
            todayDay.savedSearch!.kind as 'companies' | 'people',
            filters,
            dayCap,
            recipeAiFilter,
            channel
          );
          result.importedCount += runOutcome.emailsGenerated;
          // Surface a clear reason when this row's import returned 0.
          // Without this the user sees "Nothing was due today" and has no
          // way to know whether Apollo returned nothing, the AI gate
          // dropped everyone, or the recipe is over-narrow.
          const zeroReason = diagnose0Import(
            runOutcome.pageWalk,
            runOutcome.emailsGenerated,
            recipeAiFilter
          );
          if (zeroReason) {
            result.errors.push({ stage: 'import', detail: zeroReason });
          }
          await prisma.campaignDay.update({
            where: { id: todayDay.id },
            data: {
              ranAt: new Date(),
              status: 'completed',
              outcomeSummary: zeroReason
                ? `imported 0 [${channel}] — ${zeroReason.slice(0, 160)}`
                : `imported ${runOutcome.emailsGenerated} [${channel}]${recipeAiFilter !== 'any' ? ` (gated: ${recipeAiFilter})` : ''}`,
            },
          });
        } catch (e) {
          result.errors.push({
            stage: 'import',
            detail: e instanceof Error ? e.message : 'unknown',
          });
        }
      }
    } else {
      // No scheduled day — fall back to the legacy single recipe. Per-click
      // cap matches the CampaignDay path: each invocation imports up to
      // dailyImportCap MORE emails.
      const remaining = config.dailyImportCap;
      if (remaining === 0) {
        result.errors.push({ stage: 'import', detail: 'daily_import_cap_reached' });
      } else if (!config.savedSearchKind || !config.savedSearchFilters) {
        result.errors.push({ stage: 'import', detail: 'no_saved_search_recipe' });
      } else {
        try {
          const runOutcome = await runSavedSearchAndImport(user, config, remaining);
          result.importedCount = runOutcome.emailsGenerated;
          const zeroReason = diagnose0Import(
            runOutcome.pageWalk,
            runOutcome.emailsGenerated,
            'any'
          );
          if (zeroReason) {
            result.errors.push({ stage: 'import', detail: zeroReason });
          }
        } catch (e) {
          result.errors.push({
            stage: 'import',
            detail: e instanceof Error ? e.message : 'unknown',
          });
        }
      }
    }
  }

  await updateJob(parentJob, { processedItems: 1, currentLabel: 'Stage 2 / 5 · Approving pending drafts…' });

  // STAGE 2 — Approve any drafts still sitting in pending_review. Useful if
  // the toggle was flipped on AFTER drafts had already been generated.
  if (config.autoApproveInitialDrafts) {
    try {
      result.approvedExistingDrafts = await approveAllPendingReview(userId);
    } catch (e) {
      result.errors.push({
        stage: 'approve_initials',
        detail: e instanceof Error ? e.message : 'unknown',
      });
    }
  }

  await updateJob(parentJob, { processedItems: 2, currentLabel: 'Stage 3 / 5 · Sending approved emails…' });

  // STAGE 3 — Send all approved_to_send up to the remaining send cap.
  if (config.autoSendApprovedEmails) {
    if (!isInSendWindow(config)) {
      result.errors.push({ stage: 'send_initials', detail: 'outside_send_window' });
    } else {
      try {
        const sent = await sendAllApproved(userId, config);
        result.sentInitial = sent;
      } catch (e) {
        result.errors.push({
          stage: 'send_initials',
          detail: e instanceof Error ? e.message : 'unknown',
        });
      }
    }
  }

  await updateJob(parentJob, { processedItems: 3, currentLabel: 'Stage 4 / 5 · Generating follow-ups…' });

  // STAGE 4 — Generate follow-ups for everything due. Each generation
  // triggers onFollowUpGenerated which honors autoApproveFollowUps.
  if (config.autoGenerateFollowUps) {
    try {
      const r = await processDueFollowUps(userId);
      result.generatedFollowUpCount = r.generated;
      if (r.failed > 0) {
        result.errors.push({
          stage: 'generate_followups',
          detail: `${r.failed} failed during generation`,
        });
      }
    } catch (e) {
      result.errors.push({
        stage: 'generate_followups',
        detail: e instanceof Error ? e.message : 'unknown',
      });
    }
  }

  await updateJob(parentJob, { processedItems: 4, currentLabel: 'Stage 5 / 5 · Sending follow-ups…' });

  // STAGE 5 — For any follow-up drafts that exist but haven't been sent
  // (toggle just flipped on, or generation happened outside the window),
  // approve + send up to the remaining cap.
  if (config.autoApproveFollowUps) {
    if (!isInSendWindow(config)) {
      result.errors.push({ stage: 'send_followups', detail: 'outside_send_window' });
    } else {
      try {
        const sent = await approveAndSendPendingFollowUps(userId, config);
        result.sentFollowUp = sent;
      } catch (e) {
        result.errors.push({
          stage: 'send_followups',
          detail: e instanceof Error ? e.message : 'unknown',
        });
      }
    }
  }

  // Persist the summary.
  const summary = summarize(result);
  await prisma.user.update({
    where: { id: userId },
    data: {
      automationLastRunAt: new Date(),
      automationLastRunSummary: summary,
    },
  });

  await completeJob(parentJob, {
    processedItems: 5,
    metadata: {
      imported: result.importedCount,
      sentInitial: result.sentInitial,
      sentFollowUp: result.sentFollowUp,
      generatedFollowUp: result.generatedFollowUpCount,
      errors: result.errors.length,
    },
  });

  void failJob; // unused but exported from jobs.ts — keep import alive
  return result;
}

function emptyResult(seed: Partial<OrchestrationResult>): OrchestrationResult {
  return {
    ran: seed.ran ?? false,
    skippedReason: seed.skippedReason,
    importedCount: 0,
    generatedFollowUpCount: 0,
    approvedExistingDrafts: 0,
    sentInitial: 0,
    sentFollowUp: 0,
    errors: [],
  };
}

function summarize(r: OrchestrationResult): string {
  if (!r.ran) return `skipped: ${r.skippedReason || 'unknown'}`;
  const parts = [
    `imported=${r.importedCount}`,
    `approved=${r.approvedExistingDrafts}`,
    `sentInitial=${r.sentInitial}`,
    `genFollowUp=${r.generatedFollowUpCount}`,
    `sentFollowUp=${r.sentFollowUp}`,
    `errors=${r.errors.length}`,
  ];
  return parts.join(' · ');
}

// ────────────────────────────────────────────────────────────────────────
// Stage helpers.
// ────────────────────────────────────────────────────────────────────────

/**
 * Run the user's saved search, dedupe against already-imported orgs, ingest
 * up to `limit` companies through the normal import path.
 *
 * Returns the number of companies actually imported (== number that had a
 * contact found + email generated). Skipped/failed rows are still imported
 * as Company rows but in email_not_generated state.
 */
/**
 * Generic recipe-driven import. Used by the campaign path: given a recipe
 * kind + filters object, run the corresponding Apollo search, dedupe
 * against already-imported orgs, ingest top `limit` rows through the
 * shared import pipeline. Returns count actually imported.
 */
/**
 * Return shape of a recipe-driven import. The orchestrator inspects
 * `pageWalk` so it can surface real reasons for a 0-import outcome
 * (Apollo returned nothing, AI gate rejected everything, contacts had
 * no email) instead of leaving the run summary blank.
 */
interface RecipeRunResult {
  emailsGenerated: number;
  pageWalk: {
    target: number;
    pagesScanned: number;
    apolloRowsScanned: number;
    matchesFound: number;
    alreadyImported: number;
    detectionsRun: number;
  };
}

async function runRecipeAndImport(
  user: User,
  kind: 'companies' | 'people',
  filters: Record<string, unknown>,
  limit: number,
  aiFilter: 'any' | 'no_ai' | 'has_ai' = 'any',
  channel: 'email' | 'linkedin' = 'email'
): Promise<RecipeRunResult> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo or Gemini API key not configured');
  }

  // ALL three paths (any / no_ai / has_ai) use the same fused walk-and-import
  // primitive. Success metric is emails generated, not companies imported —
  // the walker keeps fetching Apollo pages until `limit` emails have been
  // generated OR the walk budget (200 fresh companies) is exhausted.
  const importMod = await import('./company-import');
  if (kind === 'companies') {
    const summary = await importMod.importCompaniesWithAiFilter(user, filters as any, {
      target: limit,
      aiFilter,
      channel,
    });
    return { emailsGenerated: summary.emailsGenerated, pageWalk: summary.pageWalk };
  }
  const summary = await importMod.importPeopleWithAiFilter(user, filters as any, {
    target: limit,
    aiFilter,
    channel,
  });
  return { emailsGenerated: summary.emailsGenerated, pageWalk: summary.pageWalk };
}

/**
 * Turn a 0-import outcome into a human-readable reason. Returns null
 * when the run actually produced emails — callers should only push the
 * returned detail string into result.errors when it is non-null.
 */
function diagnose0Import(
  pageWalk: RecipeRunResult['pageWalk'],
  emailsGenerated: number,
  aiFilter: 'any' | 'no_ai' | 'has_ai'
): string | null {
  if (emailsGenerated > 0) return null;
  if (pageWalk.apolloRowsScanned === 0) {
    return 'Apollo returned 0 matches for this recipe. Your filters may be too narrow — try removing keywords or widening locations/employee range.';
  }
  if (pageWalk.alreadyImported >= pageWalk.apolloRowsScanned) {
    return `All ${pageWalk.apolloRowsScanned} Apollo rows were already imported earlier. Clear the FetchedOrganization cache or pick a different recipe to find new contacts.`;
  }
  if (aiFilter !== 'any' && pageWalk.matchesFound === 0) {
    const direction = aiFilter === 'has_ai' ? 'AI-native' : 'no-AI';
    return `Apollo returned ${pageWalk.apolloRowsScanned} rows but none passed the "${direction}" AI gate. Loosen the gate (set aiFilter to "any") or widen the filters so more candidates are evaluated.`;
  }
  if (pageWalk.matchesFound > 0) {
    return `Apollo returned ${pageWalk.matchesFound} matches but none had a findable contact + email. Consider switching this recipe to "people"-kind, or pick a recipe targeting larger companies (10+ headcount).`;
  }
  return 'Apollo returned data but no emails were generated. Open the job details for the per-row reasons.';
}

async function runSavedSearchAndImport(
  user: User,
  config: AutomationConfig,
  limit: number
): Promise<RecipeRunResult> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo or Gemini API key not configured');
  }
  const emptyWalk = {
    target: limit,
    pagesScanned: 0,
    apolloRowsScanned: 0,
    matchesFound: 0,
    alreadyImported: 0,
    detectionsRun: 0,
  };
  if (!config.savedSearchKind || !config.savedSearchFilters) {
    return { emailsGenerated: 0, pageWalk: emptyWalk };
  }

  // Legacy fallback path (no CampaignDay scheduled) — keeps fetching until
  // `limit` emails are generated, just like the recipe path. No AI gate
  // since this path doesn't know about per-recipe aiFilter.
  const importMod = await import('./company-import');
  if (config.savedSearchKind === 'companies') {
    const summary = await importMod.importCompaniesWithAiFilter(
      user,
      config.savedSearchFilters as any,
      { target: limit, aiFilter: 'any' }
    );
    return { emailsGenerated: summary.emailsGenerated, pageWalk: summary.pageWalk };
  }
  void findBestContact;
  const summary = await importMod.importPeopleWithAiFilter(
    user,
    config.savedSearchFilters as any,
    { target: limit, aiFilter: 'any' }
  );
  return { emailsGenerated: summary.emailsGenerated, pageWalk: summary.pageWalk };
}

/**
 * Approve every Company in pending_review for this user. Used when the
 * toggle is flipped on after drafts already exist.
 */
async function approveAllPendingReview(userId: string): Promise<number> {
  const companies = await prisma.company.findMany({
    where: { userId, pipelineState: PIPELINE_STATES.PENDING_REVIEW },
    include: { email: true },
  });

  let approved = 0;
  for (const c of companies) {
    if (!c.email) continue;
    const finalSubject = c.email.editedSubject || c.email.subject;
    const finalBody = c.email.editedBody || c.email.body;
    await prisma.email.update({
      where: { id: c.email.id },
      data: {
        approvedAt: new Date(),
        approvedBy: `auto:${userId}`,
        finalSubject,
        finalBody,
      },
    });
    const t = await transitionState(
      userId,
      c.id,
      PIPELINE_STATES.APPROVED_TO_SEND,
      `auto:${userId}`,
      { reason: 'autoApproveInitialDrafts:batch' }
    );
    if (t.success) approved++;
  }
  return approved;
}

/**
 * Send every Company in approved_to_send for this user up to the remaining
 * daily send cap.
 */
async function sendAllApproved(
  userId: string,
  config: AutomationConfig
): Promise<number> {
  const used = await sendsToday(userId);
  let budget = Math.max(0, config.dailySendCap - used);
  if (budget === 0) return 0;

  const companies = await prisma.company.findMany({
    where: {
      userId,
      pipelineState: PIPELINE_STATES.APPROVED_TO_SEND,
      // Auto-send is email-only. LinkedIn rows require manual paste — they
      // sit in APPROVED_TO_SEND until the user opens the LinkedInSendModal
      // and marks them sent. Filtering at the query level (rather than just
      // relying on the sendApprovedEmail guard) keeps the audit log clean
      // and avoids burning iterations on rows that would always fail.
      email: { channel: 'email' },
    },
    take: budget,
    orderBy: { updatedAt: 'asc' },
  });

  let sent = 0;
  for (const c of companies) {
    if (!c.targetContactEmail) continue;
    if (budget <= 0) break;
    const r = await sendApprovedEmail(
      userId,
      c.id,
      c.targetContactEmail,
      `auto:${userId}`
    );
    if (r.success) {
      sent++;
      budget--;
    }
  }
  return sent;
}

/**
 * Approve + send any FollowUpEmail rows that are pending (no sentAt) up to
 * the remaining cap. Called as STAGE 5 of orchestration.
 */
async function approveAndSendPendingFollowUps(
  userId: string,
  config: AutomationConfig
): Promise<number> {
  const used = await sendsToday(userId);
  let budget = Math.max(0, config.dailySendCap - used);
  if (budget === 0) return 0;

  const pending = await prisma.followUpEmail.findMany({
    where: {
      sentAt: null,
      channel: 'email', // LinkedIn follow-ups are manual-paste — skip them here.
      company: { userId, clientStatus: 'contacted' },
    },
    include: { company: true },
    orderBy: { generatedAt: 'asc' },
    take: budget,
  });

  let sent = 0;
  for (const fu of pending) {
    if (budget <= 0) break;
    if (!fu.company.targetContactEmail) continue;

    // Approve in-place if needed.
    if (!fu.approvedAt) {
      await prisma.followUpEmail.update({
        where: { id: fu.id },
        data: {
          approvedAt: new Date(),
          approvedBy: `auto:${userId}`,
          reviewedAt: new Date(),
          reviewedBy: `auto:${userId}`,
          finalSubject: fu.editedSubject || fu.subject,
          finalBody: fu.editedBody || fu.body,
        },
      });
    }
    const r = await sendApprovedFollowUp(
      userId,
      fu.id,
      fu.company.targetContactEmail,
      `auto:${userId}`
    );
    if (r.success) {
      sent++;
      budget--;
    }
  }
  return sent;
}

// Suppress unused-import warning — generateNextFollowUp is part of the
// public surface of this module's neighbors but not used directly here.
void generateNextFollowUp;
