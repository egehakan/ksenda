/**
 * Shared import pipeline for both /api/companies/import (company-first flow)
 * and /api/people/import (people-first flow), plus the automation
 * orchestrator. Single source of truth for the upsert + contact discovery +
 * Gemini generation chain.
 *
 * Calling this directly bypasses the HTTP layer but uses the same per-row
 * processCompany logic the manual import button already does, including
 * the auto-progression hook (onInitialEmailGenerated) which honors the
 * autoApproveInitialDrafts / autoSendApprovedEmails toggles.
 */
import prisma from '@/lib/prisma';
import type { User } from '@/generated/prisma';
import {
  findBestContact,
  enrichPerson,
  searchCompanies,
  searchPeople,
  bulkMatchPeople,
  type ApolloCompany,
  type ApolloPerson,
  type ApolloFilters,
  type ApolloPeopleFilters,
} from './apollo';
import {
  generateEmailWithRetry,
  generateLinkedInMessageWithRetry,
  type SenderProfile,
} from './gemini';
import { transitionState, markEmailNotGenerated } from './pipeline';
import { PIPELINE_STATES, GEMINI_MODEL } from '@/lib/constants';
import { createJob, updateJob, completeJob, failJob, appendJobDetail, type JobKind } from './jobs';
import {
  getCachedDetectionByDomain,
  detectAiForTargetsWithStats,
  detectionMatchesFilter,
  normalizeDomain,
  type AiDetectionResult,
} from './ai-detector';

/**
 * Look up the AI-detection cache for a domain and return the Company-row
 * subset of columns. Returns an empty object on miss — caller spreads it
 * into the Company.create data so missing fields fall back to schema
 * defaults (all null).
 */
async function getAiDetectionForCreate(
  userId: string,
  domain: string | undefined
): Promise<{ aiHasAi?: boolean; aiStatusJson?: string; aiCheckedAt?: Date }> {
  if (!domain) return {};
  const cached = await getCachedDetectionByDomain(userId, domain);
  if (!cached) return {};
  return {
    aiHasAi: cached.hasAi,
    aiStatusJson: JSON.stringify(cached),
    aiCheckedAt: cached.checkedAt ? new Date(cached.checkedAt) : new Date(),
  };
}

/**
 * Format the persisted Company.aiStatusJson into a 1-3 line summary the
 * email generator can drop into the prompt context. Returns undefined if
 * detection hasn't run.
 */
function buildAiDetectionSummary(aiStatusJson: string | null | undefined): string | undefined {
  if (!aiStatusJson) return undefined;
  try {
    const r = JSON.parse(aiStatusJson) as AiDetectionResult;
    const lines: string[] = [];
    const verdict =
      r.confidence === 'confirmed_has_ai'
        ? 'CONFIRMED: company already deploys AI in product or operations.'
        : r.confidence === 'probably_no_ai'
        ? 'PROBABLY NO AI: ambiguous signal, but no production AI deployment confirmed.'
        : r.confidence === 'definitely_no_ai'
        ? 'NO AI: company has no observable AI deployment in product or operations.'
        : 'UNKNOWN: detection inconclusive.';
    lines.push(verdict);
    if (r.summary) lines.push(`Summary: ${r.summary}`);
    if (r.operationalSignals && r.operationalSignals.length > 0) {
      lines.push(
        `Operational pain signals (use as opener hooks): ${r.operationalSignals.slice(0, 5).join('; ')}`
      );
    }
    return lines.join('\n');
  } catch {
    return undefined;
  }
}
// NOTE: automation imports from this module (lazy), so we lazy-import the
// auto-progression hook here too to avoid a circular module-load order.

// Two-stage import pipeline knobs.
//
// Why two stages and not one chunk-size: Apollo find-contact is bursty
// (~1-5s/row, 1-2 API calls) while Gemini generation is the long pole
// (~10-30s/row). If you Promise.all the whole thing in chunks, the find-
// contact workers idle waiting for Gemini, which makes the visible "10
// imports" feel like it stalls every time 2-3 of them hit the model. The
// pipeline keeps stage A (find) running on the next companies WHILE
// stage B (generate) is still working through the first batch — so the
// observable throughput goes up by ~2-3× on the typical mix.
//
//   PIPELINE_FIND_CONCURRENCY   — how many find-contact calls fly at once.
//   PIPELINE_GEN_CONCURRENCY    — how many generate-email calls fly at once.
//                                  Lower than find on purpose: Gemini rate
//                                  limits are tighter and per-user keys
//                                  vary in tier. 3 matches the historical
//                                  historical chunk size used for the
//                                  Pro model and stays well within the
//                                  free-tier RPM cap (~15/min).
const PIPELINE_FIND_CONCURRENCY = 6;
const PIPELINE_GEN_CONCURRENCY = 3;

/**
 * Result of the contact-finding phase. Either the row terminates inside
 * phase A (no contact found, hard error before generation can run) and
 * we already have the final ProcessOutcome, or we have a closure that
 * runs phase B (Gemini generation + DB writes) when a generation slot
 * opens up.
 */
export type PhaseAResult =
  | { kind: 'terminal'; outcome: ProcessOutcome }
  | { kind: 'ready'; phaseB: () => Promise<ProcessOutcome> };

/**
 * A streaming source of pipeline items. The producer pushes items via
 * `emit()` as it discovers them (e.g. an Apollo page-walk + AI-detection
 * gate) and resolves when the input is exhausted. It SHOULD bail early
 * when `shouldStop()` returns true (the cap is already satisfiable) to
 * avoid wasting upstream work — but correctness never depends on it: the
 * Stage B atomic reservation caps generation regardless of over-emission.
 */
export type PipelineProducer<TItem> = (sink: {
  emit: (item: TItem) => void;
  shouldStop: () => boolean;
}) => Promise<void>;

/** Wrap a static array as a producer so the array and streaming call
 *  paths share one implementation. Emits in order, stopping early on
 *  `shouldStop()` — exactly where the old index-race loop checked
 *  `generated >= target`. */
function arrayProducer<TItem>(items: TItem[]): PipelineProducer<TItem> {
  return async ({ emit, shouldStop }) => {
    for (const it of items) {
      if (shouldStop()) return;
      emit(it);
    }
  };
}

/**
 * Producer/consumer pipeline for the import flow.
 *
 *   producer ─▶ input queue ─▶ [find-contact workers ×N] ─▶ generate queue ─▶ [generate workers ×M] ─▶ outcomes
 *
 * The producer streams items into an input queue; find workers pull from
 * it (parking until the producer emits or closes). This lets detection /
 * page-walk of LATER candidates overlap find+generate of earlier ones
 * instead of fully completing detection before any generation starts.
 *
 * Stop conditions, all preserved:
 *   - `generated >= target`  (we hit the daily cap; further work is wasted)
 *   - input exhausted        (producer resolved and queue drained)
 *
 * The cap guarantee is entirely on the Stage B side (atomic
 * `generated + inFlight >= target` reservation) so it holds no matter how
 * the producer behaves. Onlookers (`onTick`) get a progress nudge after
 * every outcome. A static array first arg is wrapped via `arrayProducer`,
 * so existing array callers are byte-for-byte unchanged.
 */
async function runImportPipeline<TItem>(
  input: TItem[] | PipelineProducer<TItem>,
  phaseA: (item: TItem) => Promise<PhaseAResult>,
  opts: {
    target: number;
    /** Starting `generated` count (so the pipeline can stop early if we
     *  were already partway through the cap). */
    generated: number;
    findConcurrency?: number;
    genConcurrency?: number;
  },
  onOutcome: (outcome: ProcessOutcome) => void,
  onTick?: (progress: { generated: number; processed: number }) => Promise<void>
): Promise<{ generated: number; processed: number }> {
  const findConcurrency = Math.max(1, opts.findConcurrency ?? PIPELINE_FIND_CONCURRENCY);
  const genConcurrency = Math.max(1, opts.genConcurrency ?? PIPELINE_GEN_CONCURRENCY);
  let generated = opts.generated;
  let processed = 0;
  // `inFlight` is the number of generation-stage workers currently inside
  // their await — i.e. slots already reserved against the target. Gen
  // workers MUST gate on (generated + inFlight < target) before pulling,
  // otherwise N concurrent workers all pass the naive `generated < target`
  // check and each commits an extra generation, producing 25→27 overshoot.
  let inFlight = 0;

  // Slot-release wake list. Every gen worker that has no headroom parks
  // a resolver here and awaits its promise. When ANY gen worker finishes
  // (success OR failure), `notifySlotFree()` drains the list so every
  // parked worker re-checks the live counters and either reserves or
  // re-parks against the next release.
  let slotWaiters: Array<() => void> = [];
  const notifySlotFree = () => {
    if (slotWaiters.length === 0) return;
    const toWake = slotWaiters;
    slotWaiters = [];
    for (const w of toWake) w();
  };
  const waitForSlot = (): Promise<void> =>
    new Promise((r) => slotWaiters.push(r));

  // Simple unbounded async queue between phase A and phase B. Bounded
  // queue isn't needed because the input is already bounded (PER_PAGE_BURST
  // + WALK_BUDGET upstream) and every queued item represents a row that
  // already cost an Apollo call — memory-tiny compared to the work it
  // represents.
  type Pending = () => Promise<ProcessOutcome>;
  const pending: Pending[] = [];
  const pullWaiters: Array<(p: Pending | null) => void> = [];
  let producersClosed = false;

  const push = (p: Pending) => {
    if (pullWaiters.length > 0) {
      pullWaiters.shift()!(p);
    } else {
      pending.push(p);
    }
  };
  const close = () => {
    if (producersClosed) return;
    producersClosed = true;
    while (pullWaiters.length > 0) pullWaiters.shift()!(null);
    // Wake any slot-waiters too so they can re-check and exit cleanly
    // once the upstream is done.
    notifySlotFree();
  };
  const pull = (): Promise<Pending | null> => {
    if (pending.length > 0) return Promise.resolve(pending.shift()!);
    if (producersClosed) return Promise.resolve(null);
    return new Promise((resolve) => pullWaiters.push(resolve));
  };

  // Input queue between the streaming producer and Stage A — same shape
  // as the A→B queue above. Find workers park here until the producer
  // emits or closes, so they idle (cheap) instead of busy-looping while
  // detection of the next burst is still in flight.
  const inputQ: TItem[] = [];
  const inputWaiters: Array<(v: TItem | null) => void> = [];
  let inputClosed = false;
  const inputPush = (it: TItem) => {
    if (inputWaiters.length > 0) inputWaiters.shift()!(it);
    else inputQ.push(it);
  };
  const inputClose = () => {
    if (inputClosed) return;
    inputClosed = true;
    while (inputWaiters.length > 0) inputWaiters.shift()!(null);
  };
  const inputPull = (): Promise<TItem | null> => {
    if (inputQ.length > 0) return Promise.resolve(inputQ.shift()!);
    if (inputClosed) return Promise.resolve(null);
    return new Promise((resolve) => inputWaiters.push(resolve));
  };

  // Drive the producer concurrently with the workers. A static array is
  // wrapped so the array path is provably identical to the old loop. A
  // producer throw is captured and re-thrown AFTER the pipeline drains,
  // so callers' try/catch → failJob still fires (parity with the old
  // page-walk that threw on Apollo errors) without hanging the workers.
  const producer: PipelineProducer<TItem> = Array.isArray(input)
    ? arrayProducer(input)
    : input;
  let producerError: unknown = null;
  const producerDone = Promise.resolve()
    .then(() =>
      producer({
        emit: inputPush,
        shouldStop: () => generated >= opts.target,
      })
    )
    .catch((e) => {
      producerError = e;
    })
    .finally(inputClose);

  // Stage A: find-contact workers pull from the input queue.
  const findWorkers = Array.from({ length: findConcurrency }, async () => {
    while (true) {
      if (generated >= opts.target) return;
      const item = await inputPull();
      if (item === null) return;
      const result = await phaseA(item);
      if (result.kind === 'terminal') {
        onOutcome(result.outcome);
        processed++;
        if (onTick) await onTick({ generated, processed });
      } else {
        push(result.phaseB);
      }
    }
  });

  // Stage B: generate workers reserve a slot atomically (sync check +
  // increment, no awaits between them), pull, run. On finish — success
  // OR failure — they release the slot and wake any parked worker.
  const genWorkers = Array.from({ length: genConcurrency }, async () => {
    while (true) {
      if (generated >= opts.target) return;
      if (generated + inFlight >= opts.target) {
        // No headroom. inFlight > 0 here is guaranteed: if inFlight were
        // 0 then generated >= target, which the outer check above caught.
        // Park until an in-flight finishes and re-check the live state.
        await waitForSlot();
        continue;
      }
      // Atomic reservation — the check on the line above and this
      // increment have no await between them, so JS's single-threaded
      // execution model makes this race-free.
      inFlight++;
      try {
        const next = await pull();
        if (!next) return; // queue closed and empty
        const outcome = await next();
        if (outcome.emailGenerated) generated++;
        onOutcome(outcome);
        processed++;
        if (onTick) await onTick({ generated, processed });
      } finally {
        inFlight--;
        notifySlotFree();
      }
    }
  });

  // Close the queue when find workers run dry so generate workers can
  // finish draining without hanging on the next pull().
  Promise.all(findWorkers).then(close).catch(close);

  await Promise.all([producerDone, ...findWorkers, ...genWorkers]);
  // Belt-and-suspenders: if generate workers exited via the target check
  // while items remain in pending (or the producer raced ahead), mark
  // both queues closed so a stray pull would return null instead of
  // hanging in a follow-on iteration.
  close();
  inputClose();

  // Surface a producer failure now that the workers have drained, so the
  // caller's try/catch can fail the job (matches the old behavior where
  // an Apollo page-fetch throw aborted the walk).
  if (producerError) throw producerError;

  return { generated, processed };
}

export interface ImportSummary {
  imported: number;
  emailsGenerated: number;
  noContact: number;
  errors: number;
  companies: Array<{ id: string; name: string; state: string }>;
  errorDetails: Array<{ companyName: string; error: string }>;
  autoApproved: number;
  autoSent: number;
}

export interface ProcessContext {
  userId: string;
  userEmail: string;
  apolloKey: string;
  geminiKey: string;
  sender: SenderProfile;
  promptOverride?: string;
  /** Outreach channel; defaults to 'email'. */
  channel?: 'email' | 'linkedin';
  /** When set, each per-row state transition appends a detail entry so the
   *  expanded job widget shows "finding_contact → generating → pending_review"
   *  per company. */
  jobId?: string | null;
}

type ProcessOutcome = {
  imported: boolean;
  emailGenerated: boolean;
  noContact: boolean;
  error: boolean;
  autoApproved: boolean;
  autoSent: boolean;
  company?: { id: string; name: string; state: string };
  errorDetail?: { companyName: string; error: string };
};

async function getActivePromptContent(
  userId: string,
  platform: 'email' | 'linkedin' = 'email'
): Promise<string | undefined> {
  const prompt = await prisma.prompt.findFirst({
    where: { userId, name: 'active_prompt', platform },
  });
  return prompt?.content;
}

export function buildContext(
  user: User,
  promptOverride?: string,
  channel: 'email' | 'linkedin' = 'email'
): ProcessContext {
  if (!user.apolloApiKey) throw new Error('Apollo API key not configured');
  if (!user.geminiApiKey) throw new Error('Gemini API key not configured');
  return {
    userId: user.id,
    userEmail: user.email,
    apolloKey: user.apolloApiKey,
    geminiKey: user.geminiApiKey,
    sender: {
      companyName: user.companyName,
      companyWebsite: user.companyWebsite,
      senderName: user.senderName,
    },
    promptOverride,
    channel,
  };
}

/**
 * Phase A of the company import — the Apollo-bound work: upsert the
 * Company row, find the best target contact, and capture everything the
 * generation step will need. Stops with a terminal ProcessOutcome when
 * the row can't progress (no apollo id, no contact, no email). When a
 * contact + email are in hand, returns a phaseB closure that the
 * pipeline runs once a generation slot opens.
 *
 * Split out of processCompanyRow so the pipeline can keep stage A
 * running on the next companies while Gemini chews on the slow stage B.
 */
export async function processCompanyRowPhaseA(
  ctx: ProcessContext,
  company: ApolloCompany
): Promise<PhaseAResult> {
  const out: ProcessOutcome = {
    imported: false,
    emailGenerated: false,
    noContact: false,
    error: false,
    autoApproved: false,
    autoSent: false,
  };

  try {
    const orgId = company.organization_id || company.id;

    let dbCompany = await prisma.company.findFirst({
      where: {
        userId: ctx.userId,
        OR: [{ apolloId: orgId }, { domain: company.domain || '' }],
      },
    });
    if (dbCompany) {
      dbCompany = await prisma.company.update({
        where: { id: dbCompany.id },
        data: { apolloId: orgId },
      });
    } else {
      const aiSeed = await getAiDetectionForCreate(ctx.userId, company.domain);
      dbCompany = await prisma.company.create({
        data: {
          userId: ctx.userId,
          apolloId: orgId,
          name: company.name,
          domain: company.domain || '',
          website: company.website_url,
          industry: company.industry,
          location: [company.city, company.state, company.country].filter(Boolean).join(', '),
          employeeCount: company.employee_count,
          pipelineState: 'pending_generation',
          ...aiSeed,
        },
      });
    }

    await prisma.fetchedOrganization.upsert({
      where: { userId_apolloId: { userId: ctx.userId, apolloId: orgId } },
      update: {},
      create: {
        userId: ctx.userId,
        apolloId: orgId,
        domain: company.domain || company.primary_domain,
        name: company.name,
      },
    });
    out.imported = true;

    if (!dbCompany.apolloId) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'no_apollo_id');
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }

    await appendJobDetail(ctx.jobId ?? null, {
      name: dbCompany.name,
      status: 'finding_contact',
    });
    const bestContact = await findBestContact(
      ctx.apolloKey,
      dbCompany.name,
      dbCompany.apolloId,
      ctx.userId,
      ctx.channel ?? 'email'
    );
    if (!bestContact.person) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'no_valid_contact_found');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'No valid contact found in Apollo',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }

    const channel = ctx.channel ?? 'email';

    await prisma.company.update({
      where: { id: dbCompany.id },
      data: {
        targetContactFirstName: bestContact.person.first_name || null,
        targetContactLastName: bestContact.person.last_name || null,
        targetContactEmail: bestContact.enrichedEmail || null,
        targetContactTitle: bestContact.title || bestContact.person.title || null,
        targetContactLinkedinUrl: bestContact.person.linkedin_url || null,
        contactFoundAt: new Date(),
      },
    });

    if (channel === 'email' && !bestContact.enrichedEmail) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'contact_found_no_email');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'Contact found but no email available',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }
    if (channel === 'linkedin' && !bestContact.person.linkedin_url) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'contact_found_no_linkedin');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'Contact found but no LinkedIn URL available',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }

    // Hand off everything the Gemini call needs to the closure. We
    // resolve promptToUse / aiDetectionSummary now, in stage A, because
    // (a) they involve DB reads that should not block a generation slot
    // and (b) the dbCompany row may be mutated by other stages before
    // phaseB runs, so we want a frozen snapshot.
    const promptToUse =
      ctx.promptOverride || (await getActivePromptContent(ctx.userId, channel));
    const aiDetectionSummary = buildAiDetectionSummary(dbCompany.aiStatusJson);
    const dbCompanyId = dbCompany.id;
    const dbCompanyName = dbCompany.name;
    const dbCompanyDomain = dbCompany.domain;
    const dbCompanyWebsite = dbCompany.website || undefined;
    const contactFirst = bestContact.person.first_name || '';
    const contactLast = bestContact.person.last_name || undefined;
    const contactTitle = bestContact.title || bestContact.person.title || undefined;

    const phaseB = async (): Promise<ProcessOutcome> => {
      try {
        const generatingDetailLabel =
          channel === 'linkedin' ? 'generating_linkedin' : 'generating';
        await appendJobDetail(ctx.jobId ?? null, {
          name: dbCompanyName,
          status: generatingDetailLabel,
          detail: `Contact: ${contactFirst} ${contactLast || ''} · ${contactTitle || ''}`.trim(),
        });

        const generationOpts = {
          apiKey: ctx.geminiKey,
          companyName: dbCompanyName,
          companyDomain: dbCompanyDomain,
          customPrompt: promptToUse,
          companyWebsite: dbCompanyWebsite,
          contact: {
            firstName: contactFirst,
            lastName: contactLast,
            title: contactTitle,
          },
          sender: ctx.sender,
          aiDetectionSummary,
        };

        if (channel === 'linkedin') {
          const liResult = await generateLinkedInMessageWithRetry(generationOpts);
          if (!liResult.success) {
            await markEmailNotGenerated(
              ctx.userId,
              dbCompanyId,
              `linkedin_generation_failed: ${liResult.error}`
            );
            await appendJobDetail(ctx.jobId ?? null, {
              name: dbCompanyName,
              status: 'failed',
              detail: `LinkedIn message generation failed: ${liResult.error || 'unknown'}`,
            });
            out.error = true;
            out.errorDetail = {
              companyName: dbCompanyName,
              error: liResult.error || 'unknown',
            };
            out.company = { id: dbCompanyId, name: dbCompanyName, state: 'email_not_generated' };
            return out;
          }

          await prisma.email.create({
            data: {
              companyId: dbCompanyId,
              channel: 'linkedin',
              subject: null,
              body: liResult.body!,
              promptUsed: promptToUse || '',
              geminiModelUsed: GEMINI_MODEL,
            },
          });
          await transitionState(ctx.userId, dbCompanyId, PIPELINE_STATES.PENDING_REVIEW);
          await appendJobDetail(ctx.jobId ?? null, {
            name: dbCompanyName,
            status: 'pending_review',
            detail: liResult.body?.slice(0, 100),
          });

          await prisma.auditLog.create({
            data: {
              userId: ctx.userId,
              entityType: 'email',
              entityId: dbCompanyId,
              action: 'linkedin_generated',
              metadata: {
                bodyLength: liResult.body?.length,
                channel: 'linkedin',
                autoProcessed: true,
              },
            },
          });
          out.emailGenerated = true;

          const { onInitialEmailGenerated } = await import('./automation');
          const auto = await onInitialEmailGenerated(ctx.userId, dbCompanyId);
          out.autoApproved = auto.approved;
          out.autoSent = auto.sent;

          out.company = {
            id: dbCompanyId,
            name: dbCompanyName,
            state: out.autoSent ? 'sent' : out.autoApproved ? 'approved_to_send' : 'pending_review',
          };
          return out;
        }

        const emailResult = await generateEmailWithRetry(generationOpts);

        if (!emailResult.success) {
          await markEmailNotGenerated(
            ctx.userId,
            dbCompanyId,
            `email_generation_failed: ${emailResult.error}`
          );
          await appendJobDetail(ctx.jobId ?? null, {
            name: dbCompanyName,
            status: 'failed',
            detail: `Email generation failed: ${emailResult.error || 'unknown'}`,
          });
          out.error = true;
          out.errorDetail = { companyName: dbCompanyName, error: emailResult.error || 'unknown' };
          out.company = { id: dbCompanyId, name: dbCompanyName, state: 'email_not_generated' };
          return out;
        }

        await prisma.email.create({
          data: {
            companyId: dbCompanyId,
            channel: 'email',
            subject: emailResult.subject!,
            body: emailResult.body!,
            promptUsed: promptToUse || '',
            geminiModelUsed: GEMINI_MODEL,
          },
        });
        await transitionState(ctx.userId, dbCompanyId, PIPELINE_STATES.PENDING_REVIEW);
        await appendJobDetail(ctx.jobId ?? null, {
          name: dbCompanyName,
          status: 'pending_review',
          detail: emailResult.subject?.slice(0, 100),
        });

        await prisma.auditLog.create({
          data: {
            userId: ctx.userId,
            entityType: 'email',
            entityId: dbCompanyId,
            action: 'email_generated',
            metadata: {
              subject: emailResult.subject,
              bodyLength: emailResult.body?.length,
              autoProcessed: true,
            },
          },
        });
        out.emailGenerated = true;

        // Auto-progression hook. No-op unless the user flipped the toggles on.
        const { onInitialEmailGenerated } = await import('./automation');
        const auto = await onInitialEmailGenerated(ctx.userId, dbCompanyId);
        out.autoApproved = auto.approved;
        out.autoSent = auto.sent;

        out.company = {
          id: dbCompanyId,
          name: dbCompanyName,
          state: out.autoSent ? 'sent' : out.autoApproved ? 'approved_to_send' : 'pending_review',
        };
        return out;
      } catch (error) {
        console.error(`Error generating outreach for ${dbCompanyName}:`, error);
        out.error = true;
        out.errorDetail = {
          companyName: dbCompanyName,
          error: error instanceof Error ? error.message : 'unknown',
        };
        return out;
      }
    };

    return { kind: 'ready', phaseB };
  } catch (error) {
    console.error(`Error processing company ${company.name}:`, error);
    out.error = true;
    out.errorDetail = {
      companyName: company.name,
      error: error instanceof Error ? error.message : 'unknown',
    };
    return { kind: 'terminal', outcome: out };
  }
}

/**
 * Build a stable per-organization dedupe key for a person record. Real
 * Apollo organization_id when available (paid tier); falls back to the
 * normalized org name on free tier where organization.id isn't returned.
 * Last resort: the person's own Apollo id — unique enough to import the
 * row without crashing the upsert path.
 */
export function orgKeyForPerson(person: ApolloPerson): string {
  const real = person.organization?.id || person.organization_id;
  if (real) return real;
  const name = normalizeOrgNameKey(person.organization?.name);
  if (name) return `name:${name}`;
  return `person:${person.id}`;
}

/**
 * Canonical lowercase-dash form of an org name, used as a dedupe key
 * across the masked people-search stub and the FetchedOrganization
 * cache. Returns null when the input is empty/null. Drops common
 * suffix punctuation (".", ",", "&") so "Acme, Inc." and "Acme Inc"
 * collapse to the same key.
 */
function normalizeOrgNameKey(name?: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[.,&]/g, '')
    .replace(/\s+/g, '-');
  return cleaned || null;
}

/**
 * Multi-key view over FetchedOrganization for a user. Encapsulates the
 * dedupe rules so each walk doesn't reinvent them.
 *
 * Why three keys: Apollo's people-search masks org.id and primary_domain,
 * forcing us to fall back to a name-keyed entry; the companies-search
 * returns the real org_id. Past imports may have written either form to
 * the cache, so any new lookup must consult ALL three keys to catch
 * previously-imported orgs regardless of which path wrote them.
 *
 * The shape of the lookup object lets a single helper serve both
 * ApolloCompany (companies-walk) and ApolloPerson (people-walk) call
 * sites — each maps its own field names onto {apolloId, name, domain}.
 */
interface FetchedOrgIndex {
  has: (lookup: {
    apolloId?: string | null;
    name?: string | null;
    domain?: string | null;
  }) => boolean;
  size: number;
}

async function buildFetchedOrgIndex(userId: string): Promise<FetchedOrgIndex> {
  const fetched = await prisma.fetchedOrganization.findMany({
    where: { userId },
    select: { apolloId: true, name: true, domain: true },
  });
  const byApolloId = new Set(fetched.map((f) => f.apolloId));
  const byName = new Set<string>();
  const byDomain = new Set<string>();
  for (const f of fetched) {
    const n = normalizeOrgNameKey(f.name);
    if (n) byName.add(n);
    const d = normalizeDomain(f.domain ?? undefined);
    if (d) byDomain.add(d);
  }
  return {
    size: fetched.length,
    has: ({ apolloId, name, domain }) => {
      if (apolloId && byApolloId.has(apolloId)) return true;
      const n = normalizeOrgNameKey(name);
      if (n && byName.has(n)) return true;
      const d = normalizeDomain(domain ?? undefined);
      if (d && byDomain.has(d)) return true;
      return false;
    },
  };
}

/**
 * Upsert one person + their company, set the picked contact as the target
 * (bypassing findBestContact), generate the initial email. Mirrors
 * /api/people/import for use from automation.
 */
/**
 * Phase A of the person import — Apollo-bound work that ends with a
 * contact + valid email captured to the DB. Returns a terminal outcome
 * for rows that can't progress (no email, missing first name), or a
 * phaseB closure for the pipeline to drive into Gemini.
 */
export async function processPersonRowPhaseA(
  ctx: ProcessContext,
  person: ApolloPerson
): Promise<PhaseAResult> {
  const out: ProcessOutcome = {
    imported: false,
    emailGenerated: false,
    noContact: false,
    error: false,
    autoApproved: false,
    autoSent: false,
  };

  try {
    const org = person.organization;
    const orgKey = orgKeyForPerson(person);
    const orgName = org?.name || 'Unknown';
    const orgDomain = org?.primary_domain || org?.domain || '';

    let dbCompany = await prisma.company.findFirst({
      where: {
        userId: ctx.userId,
        OR: [{ apolloId: orgKey }, ...(orgDomain ? [{ domain: orgDomain }] : [])],
      },
    });
    if (dbCompany) {
      dbCompany = await prisma.company.update({
        where: { id: dbCompany.id },
        data: { apolloId: orgKey },
      });
    } else {
      const aiSeed = await getAiDetectionForCreate(ctx.userId, orgDomain);
      dbCompany = await prisma.company.create({
        data: {
          userId: ctx.userId,
          apolloId: orgKey,
          name: orgName,
          domain: orgDomain,
          website: org?.website_url,
          industry: org?.industry,
          location: [org?.city, org?.state, org?.country].filter(Boolean).join(', '),
          employeeCount: org?.employee_count ?? org?.organization_headcount,
          pipelineState: 'pending_generation',
          ...aiSeed,
        },
      });
    }
    await prisma.fetchedOrganization.upsert({
      where: { userId_apolloId: { userId: ctx.userId, apolloId: orgKey } },
      update: {},
      create: { userId: ctx.userId, apolloId: orgKey, domain: orgDomain || null, name: orgName },
    });
    out.imported = true;

    const channel = ctx.channel ?? 'email';

    let email = person.email || null;
    let linkedinUrl = person.linkedin_url || null;
    // Single enrichment call covers both backfills: email when we're on the
    // email channel and have a has_email hint, AND linkedin_url when we're
    // on the linkedin channel and the masked search-stub didn't include it.
    // Apollo's free/basic tier masks linkedin_url inconsistently, so this
    // is the high-value compensating step that turns "no LinkedIn URL" into
    // a generated message in most cases.
    const wantsEmailEnrich = !email && person.has_email && person.id;
    const wantsLinkedInEnrich = channel === 'linkedin' && !linkedinUrl && person.id;
    if (wantsEmailEnrich || wantsLinkedInEnrich) {
      try {
        const enriched = await enrichPerson(ctx.apolloKey, person.id!);
        if (!email) email = enriched?.email || null;
        if (!linkedinUrl) linkedinUrl = enriched?.linkedin_url || null;
      } catch {
        /* ignore enrich failures — fall through to no-contact path */
      }
    }

    await prisma.company.update({
      where: { id: dbCompany.id },
      data: {
        targetContactFirstName: person.first_name || null,
        targetContactLastName: person.last_name || null,
        targetContactEmail: email,
        targetContactTitle: person.title || null,
        targetContactLinkedinUrl: linkedinUrl,
        contactFoundAt: new Date(),
      },
    });

    if (channel === 'email' && !email) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'contact_found_no_email');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'Person has no email available',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }
    if (channel === 'linkedin' && !linkedinUrl) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'contact_found_no_linkedin');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'Person has no LinkedIn URL available',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }
    if (!person.first_name) {
      await markEmailNotGenerated(ctx.userId, dbCompany.id, 'contact_missing_first_name');
      await appendJobDetail(ctx.jobId ?? null, {
        name: dbCompany.name,
        status: 'failed',
        detail: 'Person missing first name',
      });
      out.noContact = true;
      out.company = { id: dbCompany.id, name: dbCompany.name, state: 'email_not_generated' };
      return { kind: 'terminal', outcome: out };
    }

    const promptToUse =
      ctx.promptOverride || (await getActivePromptContent(ctx.userId, channel));
    // Freeze the values phase B will need so a downstream DB update on
    // dbCompany doesn't change what we send to Gemini.
    const dbCompanyId = dbCompany.id;
    const dbCompanyName = dbCompany.name;
    const dbCompanyDomain = dbCompany.domain;
    const dbCompanyWebsite = dbCompany.website || undefined;
    const contactFirst = person.first_name;
    const contactLast = person.last_name || undefined;
    const contactTitle = person.title || undefined;

    const phaseB = async (): Promise<ProcessOutcome> => {
      try {
        await appendJobDetail(ctx.jobId ?? null, {
          name: dbCompanyName,
          status: channel === 'linkedin' ? 'generating_linkedin' : 'generating',
          detail: `Contact: ${contactFirst} ${contactLast || ''} · ${contactTitle || ''}`.trim(),
        });
        const generationOpts = {
          apiKey: ctx.geminiKey,
          companyName: dbCompanyName,
          companyDomain: dbCompanyDomain,
          customPrompt: promptToUse,
          companyWebsite: dbCompanyWebsite,
          contact: {
            firstName: contactFirst,
            lastName: contactLast,
            title: contactTitle,
          },
          sender: ctx.sender,
        };

        if (channel === 'linkedin') {
          const liResult = await generateLinkedInMessageWithRetry(generationOpts);
          if (!liResult.success) {
            await markEmailNotGenerated(
              ctx.userId,
              dbCompanyId,
              `linkedin_generation_failed: ${liResult.error}`
            );
            await appendJobDetail(ctx.jobId ?? null, {
              name: dbCompanyName,
              status: 'failed',
              detail: `LinkedIn message generation failed: ${liResult.error || 'unknown'}`,
            });
            out.error = true;
            out.errorDetail = {
              companyName: dbCompanyName,
              error: liResult.error || 'unknown',
            };
            out.company = { id: dbCompanyId, name: dbCompanyName, state: 'email_not_generated' };
            return out;
          }

          const existing = await prisma.email.findUnique({ where: { companyId: dbCompanyId } });
          if (existing) {
            await prisma.email.update({
              where: { companyId: dbCompanyId },
              data: {
                channel: 'linkedin',
                subject: null,
                body: liResult.body!,
                promptUsed: promptToUse || '',
                geminiModelUsed: GEMINI_MODEL,
              },
            });
          } else {
            await prisma.email.create({
              data: {
                companyId: dbCompanyId,
                channel: 'linkedin',
                subject: null,
                body: liResult.body!,
                promptUsed: promptToUse || '',
                geminiModelUsed: GEMINI_MODEL,
              },
            });
          }
          await transitionState(ctx.userId, dbCompanyId, PIPELINE_STATES.PENDING_REVIEW);
          await appendJobDetail(ctx.jobId ?? null, {
            name: dbCompanyName,
            status: 'pending_review',
            detail: liResult.body?.slice(0, 100),
          });
          out.emailGenerated = true;

          const { onInitialEmailGenerated: hook } = await import('./automation');
          const auto = await hook(ctx.userId, dbCompanyId);
          out.autoApproved = auto.approved;
          out.autoSent = auto.sent;

          out.company = {
            id: dbCompanyId,
            name: dbCompanyName,
            state: out.autoSent ? 'sent' : out.autoApproved ? 'approved_to_send' : 'pending_review',
          };
          return out;
        }

        const emailResult = await generateEmailWithRetry(generationOpts);
        if (!emailResult.success) {
          await markEmailNotGenerated(
            ctx.userId,
            dbCompanyId,
            `email_generation_failed: ${emailResult.error}`
          );
          await appendJobDetail(ctx.jobId ?? null, {
            name: dbCompanyName,
            status: 'failed',
            detail: `Email generation failed: ${emailResult.error || 'unknown'}`,
          });
          out.error = true;
          out.errorDetail = { companyName: dbCompanyName, error: emailResult.error || 'unknown' };
          out.company = { id: dbCompanyId, name: dbCompanyName, state: 'email_not_generated' };
          return out;
        }

        const existing = await prisma.email.findUnique({ where: { companyId: dbCompanyId } });
        if (existing) {
          await prisma.email.update({
            where: { companyId: dbCompanyId },
            data: {
              channel: 'email',
              subject: emailResult.subject!,
              body: emailResult.body!,
              promptUsed: promptToUse || '',
              geminiModelUsed: GEMINI_MODEL,
            },
          });
        } else {
          await prisma.email.create({
            data: {
              companyId: dbCompanyId,
              channel: 'email',
              subject: emailResult.subject!,
              body: emailResult.body!,
              promptUsed: promptToUse || '',
              geminiModelUsed: GEMINI_MODEL,
            },
          });
        }
        await transitionState(ctx.userId, dbCompanyId, PIPELINE_STATES.PENDING_REVIEW);
        await appendJobDetail(ctx.jobId ?? null, {
          name: dbCompanyName,
          status: 'pending_review',
          detail: emailResult.subject?.slice(0, 100),
        });
        out.emailGenerated = true;

        const { onInitialEmailGenerated: hook } = await import('./automation');
        const auto = await hook(ctx.userId, dbCompanyId);
        out.autoApproved = auto.approved;
        out.autoSent = auto.sent;

        out.company = {
          id: dbCompanyId,
          name: dbCompanyName,
          state: out.autoSent ? 'sent' : out.autoApproved ? 'approved_to_send' : 'pending_review',
        };
        return out;
      } catch (error) {
        console.error(`Error generating outreach for person at ${dbCompanyName}:`, error);
        out.error = true;
        out.errorDetail = {
          companyName: dbCompanyName,
          error: error instanceof Error ? error.message : 'unknown',
        };
        return out;
      }
    };

    return { kind: 'ready', phaseB };
  } catch (error) {
    console.error(`Error processing person ${person.id}:`, error);
    out.error = true;
    out.errorDetail = {
      companyName: person.organization?.name || 'Unknown',
      error: error instanceof Error ? error.message : 'unknown',
    };
    return { kind: 'terminal', outcome: out };
  }
}


async function runInBatches<T>(
  userId: string,
  kind: JobKind,
  rows: T[],
  getLabel: (row: T) => string,
  phaseA: (row: T) => Promise<PhaseAResult>,
  /**
   * When the caller has already opened a job (e.g. the page-walking import
   * wants ONE job spanning detection + per-row import), pass it here and
   * we'll reuse it instead of creating a new one. The caller owns the
   * job's lifecycle (completeJob/failJob) when this is provided.
   */
  existingJobId?: string | null
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    imported: 0,
    emailsGenerated: 0,
    noContact: 0,
    errors: 0,
    companies: [],
    errorDetails: [],
    autoApproved: 0,
    autoSent: 0,
  };

  const ownsJob = !existingJobId;
  const jobId =
    existingJobId ??
    (await createJob({
      userId,
      kind,
      totalItems: rows.length,
      currentLabel:
        rows.length > 0
          ? `Generating ${rows.length} email${rows.length === 1 ? '' : 's'}…`
          : undefined,
    }));
  if (!ownsJob && jobId) {
    await updateJob(jobId, {
      totalItems: rows.length,
      processedItems: 0,
      currentLabel:
        rows.length > 0
          ? `Generating for ${getLabel(rows[0])}${rows.length > 1 ? ` (+${rows.length - 1} more)` : ''}…`
          : 'Nothing to generate.',
    });
  }

  // First row label so the widget sees something meaningful immediately.
  if (rows.length > 0) {
    await updateJob(jobId, {
      processedItems: 0,
      currentLabel: `Generating for ${getLabel(rows[0])}${rows.length > 1 ? ` (+${rows.length - 1} more)` : ''}…`,
    });
  }

  try {
    // Use the two-stage pipeline so find-contact runs in parallel with
    // generate-email instead of chunked Promise.all (the older path
    // forced every chunk to wait for its slowest Gemini call before
    // starting the next chunk's contact lookups). `target = rows.length`
    // because we want to process every row — no early stop here.
    await runImportPipeline(
      rows,
      phaseA,
      { target: rows.length, generated: 0 },
      (r) => {
        if (r.imported) summary.imported++;
        if (r.emailGenerated) summary.emailsGenerated++;
        if (r.noContact) summary.noContact++;
        if (r.error) summary.errors++;
        if (r.autoApproved) summary.autoApproved++;
        if (r.autoSent) summary.autoSent++;
        if (r.company) summary.companies.push(r.company);
        if (r.errorDetail) summary.errorDetails.push(r.errorDetail);
      },
      async ({ processed }) => {
        await updateJob(jobId, {
          processedItems: processed,
          currentLabel: `Generated ${summary.emailsGenerated}/${rows.length} · ${summary.imported} imported`,
        });
      }
    );
    if (ownsJob) {
      await completeJob(jobId, {
        processedItems: rows.length,
        metadata: {
          imported: summary.imported,
          emailsGenerated: summary.emailsGenerated,
          autoSent: summary.autoSent,
        },
      });
    } else if (jobId) {
      // Caller will complete the job after we return — but update the
      // counts so the widget reflects progress through the rows.
      await updateJob(jobId, {
        processedItems: rows.length,
        currentLabel: `Generated ${summary.emailsGenerated}/${rows.length} · ${summary.imported} imported`,
      });
    }
  } catch (e) {
    if (ownsJob) {
      await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    }
    throw e;
  }

  return summary;
}

export async function importCompaniesForUser(
  user: User,
  companies: ApolloCompany[],
  promptOverride?: string,
  /** When the API route already created the GenerationJob (so it can hand
   *  the id back to the client to poll), reuse it instead of opening a
   *  second one. We still own its completeJob/failJob lifecycle. */
  existingJobId?: string | null,
  channel: 'email' | 'linkedin' = 'email'
): Promise<ImportSummary> {
  const ctx = buildContext(user, promptOverride, channel);
  const itemLabel = channel === 'linkedin' ? 'LinkedIn message' : 'email';
  // Open the job up-front so ctx.jobId is set before processCompanyRow runs;
  // the per-row state-transition events (finding_contact → generating →
  // pending_review) need it to write detail rows.
  const jobId =
    existingJobId ??
    (await createJob({
      userId: user.id,
      kind: 'company_import',
      totalItems: companies.length,
      currentLabel:
        companies.length > 0
          ? `Generating ${companies.length} ${itemLabel}${companies.length === 1 ? '' : 's'}…`
          : undefined,
      metadata: { channel },
    }));
  ctx.jobId = jobId;
  try {
    const summary = await runInBatches(
      user.id,
      'company_import',
      companies,
      (c) => c.name,
      (c) => processCompanyRowPhaseA(ctx, c),
      jobId
    );
    if (jobId) {
      await completeJob(jobId, {
        processedItems: companies.length,
        metadata: {
          channel,
          imported: summary.imported,
          emailsGenerated: summary.emailsGenerated,
          autoSent: summary.autoSent,
        },
      });
    }
    return summary;
  } catch (e) {
    if (jobId) await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    throw e;
  }
}

export async function importPeopleForUser(
  user: User,
  people: ApolloPerson[],
  promptOverride?: string,
  /** Reuse the route-created job (see importCompaniesForUser). */
  existingJobId?: string | null,
  channel: 'email' | 'linkedin' = 'email'
): Promise<ImportSummary> {
  const ctx = buildContext(user, promptOverride, channel);
  const itemLabel = channel === 'linkedin' ? 'LinkedIn message' : 'email';
  const jobId =
    existingJobId ??
    (await createJob({
      userId: user.id,
      kind: 'people_import',
      totalItems: people.length,
      currentLabel:
        people.length > 0
          ? `Generating ${people.length} ${itemLabel}${people.length === 1 ? '' : 's'}…`
          : undefined,
      metadata: { channel },
    }));
  ctx.jobId = jobId;
  try {
    const summary = await runInBatches(
      user.id,
      'people_import',
      people,
      (p) => p.organization?.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'a person',
      (p) => processPersonRowPhaseA(ctx, p),
      jobId
    );
    if (jobId) {
      await completeJob(jobId, {
        processedItems: people.length,
        metadata: {
          channel,
          imported: summary.imported,
          emailsGenerated: summary.emailsGenerated,
          autoSent: summary.autoSent,
        },
      });
    }
    return summary;
  } catch (e) {
    if (jobId) await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    throw e;
  }
}

// =============================================================================
// AI-gated, page-walking import
// =============================================================================

/**
 * Page-walk caps. Hard ceilings against runaway cost / runtime.
 *
 *   PAGE_WALK_MAX     — Apollo pages we will fetch before giving up.
 *   APOLLO_PAGE_SIZE  — rows per Apollo page (Apollo max is 100, we use 50).
 *   WALK_BUDGET       — Maximum FRESH companies examined per import (after
 *                       FetchedOrganization dedupe). Caps both Apollo usage
 *                       and Gemini detection. ~$0.36 worst-case Gemini cost.
 *   PER_PAGE_BURST    — how many fresh rows we hand to detection at a time.
 *                       Smaller bursts let us stop early when target is met.
 *
 *   detectionBudget(target) — back-compat budget for search-time walks
 *                             (which stop at gate matches, not generated
 *                             emails). Computed as min(target × 1.5,
 *                             WALK_BUDGET).
 */
const PAGE_WALK_MAX = 4;
const APOLLO_PAGE_SIZE = 50;
const WALK_BUDGET = 200;
const PER_PAGE_BURST = 10;

function detectionBudget(target: number): number {
  return Math.min(WALK_BUDGET, Math.max(1, Math.ceil(target * 1.5)));
}

export type AiFilter = 'any' | 'no_ai' | 'has_ai';

export interface PageWalkSummary {
  target: number;
  pagesScanned: number;
  apolloRowsScanned: number;
  matchesFound: number;
  /** How many Apollo rows were dropped because the cache already had them in FetchedOrganization. */
  alreadyImported: number;
  /** How many AI-detection scans actually ran (cache miss). */
  detectionsRun: number;
}

/**
 * Walk Apollo pages looking for companies that:
 *   - Are not already in FetchedOrganization for this user
 *   - Pass the aiFilter (after AI detection)
 *
 * Stops as soon as `target` matches are accumulated, or after PAGE_WALK_MAX
 * pages, whichever comes first. Returns the matches and a stats summary.
 */
export async function walkApolloCompanies(
  user: User,
  filters: ApolloFilters,
  target: number,
  aiFilter: AiFilter,
  onProgress?: (m: { matches: number; detected: number; page: number; phase: string }) => Promise<void> | void,
  /** When set, every detection result emits a GenerationJobDetail row so
   *  the user can see which companies were checked and what each verdict
   *  was in the expanded widget. */
  jobId?: string | null
): Promise<{
  matches: ApolloCompany[];
  /**
   * Every fresh row we actually ran detection on (matches + non-matches).
   * Search routes return this so the UI can show ALL checked companies
   * with their AI verdicts, not just the ones that passed the gate.
   * Order: matches first, then has-AI / unknown rows.
   */
  checked: ApolloCompany[];
  stats: PageWalkSummary;
  /** Detection result keyed by normalized domain for every row examined. */
  detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult>;
}> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo + Gemini API keys are required for AI-gated imports.');
  }
  const fetched = await prisma.fetchedOrganization.findMany({
    where: { userId: user.id },
    select: { apolloId: true },
  });
  const fetchedSet = new Set(fetched.map((f) => f.apolloId));

  const matches: ApolloCompany[] = [];
  const nonMatches: ApolloCompany[] = [];
  const detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult> = {};
  const budget = detectionBudget(target);
  const stats: PageWalkSummary = {
    target,
    pagesScanned: 0,
    apolloRowsScanned: 0,
    matchesFound: 0,
    alreadyImported: 0,
    detectionsRun: 0,
  };

  for (let page = 1; page <= PAGE_WALK_MAX; page++) {
    if (matches.length >= target) break;
    if (stats.detectionsRun >= budget) {
      console.warn(
        `[walkApolloCompanies] detection budget exhausted at ${stats.detectionsRun}/${budget}; stopping page walk.`
      );
      break;
    }
    const { companies: pageRows, pagination } = await searchCompanies(
      user.apolloApiKey,
      filters,
      page,
      APOLLO_PAGE_SIZE
    );
    stats.pagesScanned++;
    stats.apolloRowsScanned += pageRows.length;
    if (pageRows.length === 0) break;

    const fresh = pageRows.filter((c) => {
      const orgId = c.organization_id || c.id;
      if (fetchedSet.has(orgId)) {
        stats.alreadyImported++;
        return false;
      }
      return !!(c.domain || c.primary_domain);
    });

    if (onProgress) {
      await onProgress({
        matches: matches.length,
        detected: stats.detectionsRun,
        page,
        phase: `Apollo page ${page}: ${fresh.length} fresh rows`,
      });
    }

    if (aiFilter === 'any') {
      for (const c of fresh) {
        matches.push(c);
        if (matches.length >= target) break;
      }
    } else {
      // Incremental burst-based detection. Stop as soon as we hit the target.
      // PER_PAGE_BURST keeps us from over-detecting on the first page when
      // the gate is loose, while still over-fetching enough to cover a
      // strict gate's miss rate.
      for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
        if (matches.length >= target) break;
        if (stats.detectionsRun >= budget) break;
        // Trim the burst so we never exceed the budget on the last batch.
        const remainingBudget = budget - stats.detectionsRun;
        const burst = fresh.slice(off, off + Math.min(PER_PAGE_BURST, remainingBudget));
        if (burst.length === 0) break;
        const targets = burst.map((c) => ({
          name: c.name,
          domain: c.domain || c.primary_domain || '',
          website: c.website_url,
        }));
        // Emit "checking" entries up-front so the widget shows what's in
        // flight before the verdicts come back.
        if (jobId) {
          await Promise.all(
            burst.map((c) =>
              appendJobDetail(jobId, {
                name: c.name,
                status: 'checking',
                detail: c.domain || c.primary_domain || '',
              })
            )
          );
        }
        const { results: detections, stats: ds } = await detectAiForTargetsWithStats(
          targets,
          {
            geminiApiKey: user.geminiApiKey,
            userId: user.id,
          }
        );
        // Bill ONLY real Gemini calls against the budget. Cache hits are
        // free — they shouldn't burn the cap.
        stats.detectionsRun += ds.geminiCallsCount;
        for (const c of burst) {
          const dom = normalizeDomain(c.domain || c.primary_domain);
          const det = detections[dom];
          if (!det) continue;
          detectionsByDomain[dom] = det;
          if (jobId) {
            const verdictStatus =
              det.confidence === 'confirmed_has_ai'
                ? 'has_ai'
                : det.confidence === 'unknown'
                ? 'unknown_ai'
                : 'no_ai';
            await appendJobDetail(jobId, {
              name: c.name,
              status: verdictStatus,
              detail: det.summary?.slice(0, 200),
            });
          }
          if (detectionMatchesFilter(det, aiFilter)) {
            matches.push(c);
          } else {
            // Still surface non-matches in the search response so the user
            // sees ALL checked companies with their AI badges.
            nonMatches.push(c);
          }
          if (matches.length >= target) break;
        }
        if (onProgress) {
          await onProgress({
            matches: matches.length,
            detected: stats.detectionsRun,
            page,
            phase: `Detecting · page ${page} · ${matches.length}/${target} matches`,
          });
        }
      }
    }

    stats.matchesFound = matches.length;
    if (!pagination || page >= (pagination.total_pages || 1)) break;
  }

  // Matches up to target; non-matches appended after so the UI can render
  // matches at the top and the rejected-by-gate companies below.
  const trimmedMatches = matches.slice(0, target);
  return {
    matches: trimmedMatches,
    checked: [...trimmedMatches, ...nonMatches],
    stats,
    detectionsByDomain,
  };
}

/**
 * Same walk, for the people-search flow. Dedupes by org domain so we don't
 * spend detection budget on the same company twice in one page-walk.
 */
export async function walkApolloPeople(
  user: User,
  filters: ApolloPeopleFilters,
  target: number,
  aiFilter: AiFilter,
  onProgress?: (m: { matches: number; detected: number; page: number; phase: string }) => Promise<void> | void,
  jobId?: string | null
): Promise<{
  matches: ApolloPerson[];
  /** Same as walkApolloCompanies.checked — every fresh person whose org was
   *  detected, matches first, others appended. */
  checked: ApolloPerson[];
  stats: PageWalkSummary;
  detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult>;
}> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo + Gemini API keys are required for AI-gated imports.');
  }
  const fetched = await prisma.fetchedOrganization.findMany({
    where: { userId: user.id },
    select: { apolloId: true },
  });
  const fetchedSet = new Set(fetched.map((f) => f.apolloId));

  const matches: ApolloPerson[] = [];
  const nonMatches: ApolloPerson[] = [];
  const seenOrgDomain = new Set<string>();
  const detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult> = {};
  const budget = detectionBudget(target);
  const stats: PageWalkSummary = {
    target,
    pagesScanned: 0,
    apolloRowsScanned: 0,
    matchesFound: 0,
    alreadyImported: 0,
    detectionsRun: 0,
  };

  for (let page = 1; page <= PAGE_WALK_MAX; page++) {
    if (matches.length >= target) break;
    if (stats.detectionsRun >= budget) break;

    const { people: pageRows, pagination } = await searchPeople(
      user.apolloApiKey,
      filters,
      page,
      APOLLO_PAGE_SIZE
    );
    stats.pagesScanned++;
    stats.apolloRowsScanned += pageRows.length;
    if (pageRows.length === 0) break;

    const fresh = pageRows.filter((p) => {
      const orgKey = orgKeyForPerson(p);
      if (fetchedSet.has(orgKey)) {
        stats.alreadyImported++;
        return false;
      }
      const dom = normalizeDomain(p.organization?.primary_domain || p.organization?.domain);
      if (!dom) return false;
      if (seenOrgDomain.has(dom)) return false;
      seenOrgDomain.add(dom);
      return true;
    });

    if (onProgress) {
      await onProgress({
        matches: matches.length,
        detected: stats.detectionsRun,
        page,
        phase: `Apollo page ${page}: ${fresh.length} fresh orgs`,
      });
    }

    if (aiFilter === 'any') {
      for (const p of fresh) {
        matches.push(p);
        if (matches.length >= target) break;
      }
    } else {
      for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
        if (matches.length >= target) break;
        if (stats.detectionsRun >= budget) break;
        const remainingBudget = budget - stats.detectionsRun;
        const burst = fresh.slice(off, off + Math.min(PER_PAGE_BURST, remainingBudget));
        if (burst.length === 0) break;
        const targets = burst.map((p) => ({
          name: p.organization?.name || 'unknown',
          domain: normalizeDomain(p.organization?.primary_domain || p.organization?.domain),
          website: p.organization?.website_url,
        }));
        if (jobId) {
          await Promise.all(
            burst.map((p) =>
              appendJobDetail(jobId, {
                name: p.organization?.name || 'unknown',
                status: 'checking',
                detail: normalizeDomain(
                  p.organization?.primary_domain || p.organization?.domain
                ),
              })
            )
          );
        }
        const { results: detections, stats: ds } = await detectAiForTargetsWithStats(
          targets,
          {
            geminiApiKey: user.geminiApiKey,
            userId: user.id,
          }
        );
        // Only Gemini calls count toward the budget — cache hits are free.
        stats.detectionsRun += ds.geminiCallsCount;
        for (const p of burst) {
          const dom = normalizeDomain(p.organization?.primary_domain || p.organization?.domain);
          const det = detections[dom];
          if (!det) continue;
          detectionsByDomain[dom] = det;
          if (jobId) {
            const verdictStatus =
              det.confidence === 'confirmed_has_ai'
                ? 'has_ai'
                : det.confidence === 'unknown'
                ? 'unknown_ai'
                : 'no_ai';
            await appendJobDetail(jobId, {
              name: p.organization?.name || 'unknown',
              status: verdictStatus,
              detail: det.summary?.slice(0, 200),
            });
          }
          if (detectionMatchesFilter(det, aiFilter)) {
            matches.push(p);
          } else {
            nonMatches.push(p);
          }
          if (matches.length >= target) break;
        }
        if (onProgress) {
          await onProgress({
            matches: matches.length,
            detected: stats.detectionsRun,
            page,
            phase: `Detecting · page ${page} · ${matches.length}/${target} matches`,
          });
        }
      }
    }
    stats.matchesFound = matches.length;
    if (!pagination || page >= (pagination.total_pages || 1)) break;
  }
  const trimmedMatches = matches.slice(0, target);
  return {
    matches: trimmedMatches,
    checked: [...trimmedMatches, ...nonMatches],
    stats,
    detectionsByDomain,
  };
}

// =============================================================================
// Fused walk-and-import: success metric is EMAILS GENERATED, not matches
// found. Used by the automation orchestrator and the AI-gated importers.
//
// Rationale: a company can pass the AI gate but still fail downstream — no
// contact email, contact found but Gemini-generation errored, etc. The
// user expects the daily cap to mean "5 emails ready to send", not "5
// companies entered the pipeline." So the walker keeps fetching Apollo
// pages until the email-generation count hits `target` (or we exhaust the
// walk budget of 200 fresh companies, whichever comes first).
//
// Three modes:
//   aiFilter='any'    — import every fresh company until target emails
//                       generated. AI detection skipped.
//   aiFilter='no_ai'  — page-walk, AI-check, import only no-AI matches
//                       until target emails generated.
//   aiFilter='has_ai' — same flow, opposite gate.
//
// In all three, "success" = phase B emitted emailGenerated=true.
// Concurrency is owned by runImportPipeline (PIPELINE_FIND_CONCURRENCY +
// PIPELINE_GEN_CONCURRENCY) — see the constants at the top of the file.
// =============================================================================

async function detectAndPartition(
  user: User,
  burst: ApolloCompany[],
  aiFilter: AiFilter,
  detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult>,
  stats: PageWalkSummary,
  jobId: string | null
): Promise<ApolloCompany[]> {
  if (aiFilter === 'any') {
    return burst;
  }
  const targets = burst.map((c) => ({
    name: c.name,
    domain: c.domain || c.primary_domain || '',
    website: c.website_url,
  }));
  if (jobId) {
    await Promise.all(
      burst.map((c) =>
        appendJobDetail(jobId, {
          name: c.name,
          status: 'checking',
          detail: c.domain || c.primary_domain || '',
        })
      )
    );
  }
  const { results: detections, stats: ds } = await detectAiForTargetsWithStats(targets, {
    geminiApiKey: user.geminiApiKey!,
    userId: user.id,
  });
  stats.detectionsRun += ds.geminiCallsCount;
  const matching: ApolloCompany[] = [];
  for (const c of burst) {
    const dom = normalizeDomain(c.domain || c.primary_domain);
    const det = detections[dom];
    if (!det) continue;
    detectionsByDomain[dom] = det;
    if (jobId) {
      const verdictStatus =
        det.confidence === 'confirmed_has_ai'
          ? 'has_ai'
          : det.confidence === 'unknown'
          ? 'unknown_ai'
          : 'no_ai';
      await appendJobDetail(jobId, {
        name: c.name,
        status: verdictStatus,
        detail: det.summary?.slice(0, 200),
      });
    }
    if (detectionMatchesFilter(det, aiFilter)) matching.push(c);
  }
  return matching;
}

/**
 * Fused walk + import for the company-first flow, PIPELINED: an Apollo
 * page-walk + AI-detection gate streams passing companies into
 * `runImportPipeline` as it finds them, so detection of later candidates
 * overlaps find-contact + Gemini generation of earlier ones (instead of
 * detecting a whole burst, fully generating it, then fetching the next).
 *
 * Keeps walking until `target` emails are generated, OR the detection
 * budget (`detectionBudgetN`, default WALK_BUDGET=200 fresh rows)
 * exhausted, OR Apollo has no more pages. The daily cap is enforced by
 * the pipeline's Stage B atomic reservation — `generated` never exceeds
 * `target` regardless of how many companies the producer emits.
 */
export async function walkAndImportCompanies(
  user: User,
  ctx: ProcessContext,
  filters: ApolloFilters,
  target: number,
  aiFilter: AiFilter,
  jobId: string | null,
  onProgress?: (m: { generated: number; checked: number; phase: string }) => Promise<void>,
  /** Max fresh rows to examine/detect before giving up the walk. Defaults
   *  to WALK_BUDGET (200). The automation run passes the tighter
   *  min(200, ceil(cap*1.5)) to preserve its historical detection spend. */
  detectionBudgetN?: number,
  /** When the same parent job spans multiple walker passes (e.g. an
   *  automation run that processes one CampaignDay per channel), this lets
   *  each pass write CUMULATIVE progress into the job. `progressOffset` is
   *  the count generated by earlier passes; `progressTotal` is the combined
   *  cap across all passes. Both defaults preserve the single-pass behavior:
   *  progress = g / target. */
  progressOffset?: number,
  progressTotal?: number
): Promise<{
  summary: ImportSummary;
  stats: PageWalkSummary;
  detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult>;
}> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo + Gemini API keys are required.');
  }
  // Multi-key dedupe so cross-path imports get caught — if an org was
  // previously imported through the people-flow (which may write a
  // name-keyed entry into the cache), the companies-walk would miss it
  // with an apolloId-only check. The shared helper consults
  // apolloId + normalized name + normalized domain.
  const fetchedIndex = await buildFetchedOrgIndex(user.id);

  const detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult> = {};
  const summary: ImportSummary = {
    imported: 0,
    emailsGenerated: 0,
    noContact: 0,
    errors: 0,
    companies: [],
    errorDetails: [],
    autoApproved: 0,
    autoSent: 0,
  };
  const stats: PageWalkSummary = {
    target,
    pagesScanned: 0,
    apolloRowsScanned: 0,
    matchesFound: 0,
    alreadyImported: 0,
    detectionsRun: 0,
  };

  const effectiveBudget = Math.max(1, detectionBudgetN ?? WALK_BUDGET);
  let checked = 0;

  // Streaming producer: page-walk Apollo, gate via detectAndPartition,
  // emit each passing company immediately.
  //
  // It keeps feeding until the cap is ACTUALLY generated (`shouldStop()`
  // === generated >= target), Apollo runs out, or the detection safety
  // ceiling (`effectiveBudget`) is hit — NOT when emitted-but-unresolved
  // work could optimistically fill the cap. That earlier optimistic stop
  // exited the producer permanently the instant ~`target` rows were in
  // flight; any later attrition (no contact / generation error) then left
  // the run short of the cap (e.g. 19 generated + 6 no-contact for a cap
  // of 25). Over-emission is safe: the Stage B atomic reservation caps
  // generation at `target` and the find/gen workers self-stop there, so
  // the only extra cost is cheap, bounded detection — which is exactly
  // what fills the cap when contacts/gate attrition eat into it.
  const producer: PipelineProducer<ApolloCompany> = async ({ emit, shouldStop }) => {
    pageLoop: for (let page = 1; page <= PAGE_WALK_MAX; page++) {
      if (shouldStop() || checked >= effectiveBudget) {
        break;
      }

      const { companies: pageRows, pagination } = await searchCompanies(
        user.apolloApiKey!,
        filters,
        page,
        APOLLO_PAGE_SIZE
      );
      stats.pagesScanned++;
      stats.apolloRowsScanned += pageRows.length;
      if (pageRows.length === 0) break;

      const fresh = pageRows.filter((c) => {
        if (
          fetchedIndex.has({
            apolloId: c.organization_id || c.id,
            name: c.name,
            domain: c.domain || c.primary_domain,
          })
        ) {
          stats.alreadyImported++;
          return false;
        }
        return !!(c.domain || c.primary_domain);
      });

      if (onProgress) {
        await onProgress({
          generated: summary.emailsGenerated,
          checked,
          phase: `Apollo page ${page}: ${fresh.length} fresh rows`,
        });
      }

      for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
        if (shouldStop() || checked >= effectiveBudget) {
          break pageLoop;
        }
        const remaining = effectiveBudget - checked;
        const burst = fresh.slice(off, off + Math.min(PER_PAGE_BURST, remaining));
        if (burst.length === 0) break;

        const matching = await detectAndPartition(
          user,
          burst,
          aiFilter,
          detectionsByDomain,
          stats,
          jobId
        );
        checked += burst.length;
        stats.matchesFound += matching.length;

        for (const c of matching) {
          if (shouldStop()) break pageLoop;
          emit(c);
        }

        if (onProgress) {
          await onProgress({
            generated: summary.emailsGenerated,
            checked,
            phase: `Page ${page} · generated ${summary.emailsGenerated}/${target} · checked ${checked}`,
          });
        }
      }
      if (!pagination || page >= (pagination.total_pages || 1)) break;
    }
  };

  // One pipeline spanning the whole walk: detection (producer) overlaps
  // find-contact + Gemini generation. `target`/`generated:0` + the Stage B
  // atomic reservation guarantee we never generate more than the cap.
  await runImportPipeline<ApolloCompany>(
    producer,
    (c) => processCompanyRowPhaseA(ctx, c),
    { target, generated: 0 },
    (r) => {
      if (r.imported) summary.imported++;
      if (r.emailGenerated) summary.emailsGenerated++;
      if (r.noContact) summary.noContact++;
      if (r.error) summary.errors++;
      if (r.autoApproved) summary.autoApproved++;
      if (r.autoSent) summary.autoSent++;
      if (r.company) summary.companies.push(r.company);
      if (r.errorDetail) summary.errorDetails.push(r.errorDetail);
    },
    jobId
      ? async ({ generated: g }) => {
          const offset = progressOffset ?? 0;
          const total = progressTotal ?? target;
          await updateJob(jobId, {
            processedItems: offset + g,
            currentLabel: `Generated ${offset + g}/${total} · checked ${checked}`,
          });
        }
      : undefined
  );

  return { summary, stats, detectionsByDomain };
}

/**
 * Fused walk + import for the people-first flow. Dedupes by org domain so
 * we don't burn budget checking the same company twice.
 */
export async function walkAndImportPeople(
  user: User,
  ctx: ProcessContext,
  filters: ApolloPeopleFilters,
  target: number,
  aiFilter: AiFilter,
  jobId: string | null,
  onProgress?: (m: { generated: number; checked: number; phase: string }) => Promise<void>,
  /** See `walkAndImportCompanies` — combined-pass progress reporting for
   *  the automation orchestrator. */
  progressOffset?: number,
  progressTotal?: number
): Promise<{
  summary: ImportSummary;
  stats: PageWalkSummary;
  detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult>;
}> {
  if (!user.apolloApiKey || !user.geminiApiKey) {
    throw new Error('Apollo + Gemini API keys are required.');
  }
  // Multi-key dedupe. Apollo's masked people search returns no
  // organization.id and no primary_domain — just an org name — so an
  // apolloId-only check misses every time. The shared index checks all
  // three keys: apolloId, normalized name, normalized domain.
  const fetchedIndex = await buildFetchedOrgIndex(user.id);
  const isCachedHit = (p: ApolloPerson): boolean =>
    fetchedIndex.has({
      apolloId: p.organization?.id || p.organization_id,
      name: p.organization?.name,
      domain: p.organization?.primary_domain || p.organization?.domain,
    });

  const detectionsByDomain: Record<string, import('./ai-detector').AiDetectionResult> = {};
  const summary: ImportSummary = {
    imported: 0,
    emailsGenerated: 0,
    noContact: 0,
    errors: 0,
    companies: [],
    errorDetails: [],
    autoApproved: 0,
    autoSent: 0,
  };
  const stats: PageWalkSummary = {
    target,
    pagesScanned: 0,
    apolloRowsScanned: 0,
    matchesFound: 0,
    alreadyImported: 0,
    detectionsRun: 0,
  };

  let generated = 0;
  let checked = 0;
  // Pre-enrich dedupe (search-time): keys derived from masked search
  // rows — `organization.id`, falling back to `name:`-normalized. Used
  // to skip people from the same org stub before we spend credits.
  const seenOrgKey = new Set<string>();
  // Post-enrich dedupe: real organization domains, only known after
  // /people/bulk_match unmasks them.
  const seenOrgDomain = new Set<string>();

  pageLoop: for (let page = 1; page <= PAGE_WALK_MAX; page++) {
    if (generated >= target || checked >= WALK_BUDGET) break;
    const { people: pageRows, pagination } = await searchPeople(
      user.apolloApiKey,
      filters,
      page,
      APOLLO_PAGE_SIZE
    );
    stats.pagesScanned++;
    stats.apolloRowsScanned += pageRows.length;
    if (pageRows.length === 0) break;

    // Apollo's /mixed_people/api_search response is masked by design
    // across all plans: no `last_name`, no `email`, no
    // `organization.primary_domain`. Real values come from
    // /people/bulk_match below. So at this stage we can only dedupe by
    // org NAME against the multi-key cache — domain comes later.
    const fresh = pageRows.filter((p) => {
      if (isCachedHit(p)) {
        stats.alreadyImported++;
        return false;
      }
      const orgKey = orgKeyForPerson(p);
      if (seenOrgKey.has(orgKey)) return false;
      seenOrgKey.add(orgKey);
      return true;
    });

    if (onProgress) {
      await onProgress({
        generated,
        checked,
        phase: `Apollo page ${page}: ${fresh.length} fresh orgs`,
      });
    }

    for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
      if (generated >= target) break pageLoop;
      if (checked >= WALK_BUDGET) break pageLoop;
      const remaining = WALK_BUDGET - checked;
      const burstStub = fresh.slice(off, off + Math.min(PER_PAGE_BURST, remaining));
      if (burstStub.length === 0) break;

      // Bulk-enrich the burst before any downstream work. After this,
      // each person has real `email`, `last_name`,
      // `organization.primary_domain`. Drop matches that came back
      // empty (Apollo couldn't enrich) and matches whose real domain
      // collides with one we've already imported this run.
      const ids = burstStub
        .map((p) => p.id)
        .filter((id): id is string => !!id);
      const enrichedSlots = ids.length
        ? await bulkMatchPeople(user.apolloApiKey, ids, {
            revealPersonalEmails: false,
          })
        : [];
      const burst: ApolloPerson[] = [];
      for (const enriched of enrichedSlots) {
        if (!enriched) continue;
        const realDomain = normalizeDomain(
          enriched.organization?.primary_domain || enriched.organization?.domain
        );
        if (!realDomain) continue;
        if (seenOrgDomain.has(realDomain)) continue;
        // Second-pass cache check: now that enrichment has filled in
        // the real apolloId + domain, recheck the multi-key cache. The
        // search-stub may have slipped through (e.g. cached name "Acme
        // Inc" vs current stub "Acme Incorporated") — this catches it
        // before we waste a Gemini call.
        if (isCachedHit(enriched)) {
          stats.alreadyImported++;
          continue;
        }
        seenOrgDomain.add(realDomain);
        burst.push(enriched);
      }
      if (burst.length === 0) {
        checked += burstStub.length;
        continue;
      }

      // Detection happens per-org. Re-use the company partition by feeding
      // the org shape — synthesize ApolloCompany-like entries for the call.
      let matchingPeople: ApolloPerson[];
      if (aiFilter === 'any') {
        matchingPeople = burst;
      } else {
        const targets = burst.map((p) => ({
          name: p.organization?.name || 'unknown',
          domain: normalizeDomain(p.organization?.primary_domain || p.organization?.domain),
          website: p.organization?.website_url,
        }));
        if (jobId) {
          await Promise.all(
            burst.map((p) =>
              appendJobDetail(jobId, {
                name: p.organization?.name || 'unknown',
                status: 'checking',
                detail: normalizeDomain(
                  p.organization?.primary_domain || p.organization?.domain
                ),
              })
            )
          );
        }
        const { results: detections, stats: ds } = await detectAiForTargetsWithStats(targets, {
          geminiApiKey: user.geminiApiKey,
          userId: user.id,
        });
        stats.detectionsRun += ds.geminiCallsCount;
        matchingPeople = [];
        for (const p of burst) {
          const dom = normalizeDomain(p.organization?.primary_domain || p.organization?.domain);
          const det = detections[dom];
          if (!det) continue;
          detectionsByDomain[dom] = det;
          if (jobId) {
            const verdictStatus =
              det.confidence === 'confirmed_has_ai'
                ? 'has_ai'
                : det.confidence === 'unknown'
                ? 'unknown_ai'
                : 'no_ai';
            await appendJobDetail(jobId, {
              name: p.organization?.name || 'unknown',
              status: verdictStatus,
              detail: det.summary?.slice(0, 200),
            });
          }
          if (detectionMatchesFilter(det, aiFilter)) matchingPeople.push(p);
        }
      }
      checked += burst.length;
      stats.matchesFound += matchingPeople.length;

      // Two-stage pipeline — see the companies path for the rationale.
      // People-kind phase A is lighter (no findPeopleByTitle pre-call,
      // just an optional enrichPerson) but the win is identical when
      // some rows hit the enrichment hop or have validation failures.
      const pipe = await runImportPipeline(
        matchingPeople,
        (p) => processPersonRowPhaseA(ctx, p),
        { target, generated },
        (r) => {
          if (r.imported) summary.imported++;
          if (r.emailGenerated) summary.emailsGenerated++;
          if (r.noContact) summary.noContact++;
          if (r.error) summary.errors++;
          if (r.autoApproved) summary.autoApproved++;
          if (r.autoSent) summary.autoSent++;
          if (r.company) summary.companies.push(r.company);
          if (r.errorDetail) summary.errorDetails.push(r.errorDetail);
        },
        jobId
          ? async ({ generated: g }) => {
              const offset = progressOffset ?? 0;
              const total = progressTotal ?? target;
              await updateJob(jobId, {
                processedItems: offset + g,
                currentLabel: `Generated ${offset + g}/${total} · checked ${checked}`,
              });
            }
          : undefined
      );
      generated = pipe.generated;
      if (onProgress) {
        await onProgress({
          generated,
          checked,
          phase: `Page ${page} · generated ${generated}/${target} · checked ${checked}`,
        });
      }
    }
    if (!pagination || page >= (pagination.total_pages || 1)) break;
  }
  return { summary, stats, detectionsByDomain };
}

/**
 * AI-gated company import. Walks Apollo with the given filters, runs
 * batched cheap AI detection, keeps only companies matching `aiFilter`,
 * up to `target`. Then runs the standard per-row import pipeline on those
 * matches. Returns an ImportSummary extended with page-walk stats.
 */
export async function importCompaniesWithAiFilter(
  user: User,
  apolloFilters: ApolloFilters,
  opts: {
    target: number;
    aiFilter: AiFilter;
    promptOverride?: string;
    channel?: 'email' | 'linkedin';
  }
): Promise<ImportSummary & { pageWalk: PageWalkSummary }> {
  const channel = opts.channel ?? 'email';
  const ctx = buildContext(user, opts.promptOverride, channel);
  const itemLabel = channel === 'linkedin' ? 'LinkedIn message' : 'email';

  const jobId = await createJob({
    userId: user.id,
    kind: 'company_import',
    totalItems: opts.target,
    currentLabel:
      opts.aiFilter === 'any'
        ? `Generating ${opts.target} ${itemLabel}s…`
        : `Finding & generating ${opts.target} ${opts.aiFilter === 'no_ai' ? 'no-AI' : 'has-AI'} ${itemLabel}s…`,
    metadata: { channel },
  });
  ctx.jobId = jobId;

  try {
    const { summary, stats } = await walkAndImportCompanies(
      user,
      ctx,
      apolloFilters,
      opts.target,
      opts.aiFilter,
      jobId
    );
    if (jobId) {
      await completeJob(jobId, {
        processedItems: summary.emailsGenerated,
        metadata: {
          channel,
          imported: summary.imported,
          emailsGenerated: summary.emailsGenerated,
          autoSent: summary.autoSent,
          detected: stats.detectionsRun,
          pages: stats.pagesScanned,
          rowsChecked: stats.apolloRowsScanned,
        },
      });
    }
    return { ...summary, pageWalk: stats };
  } catch (e) {
    if (jobId) await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    throw e;
  }
}

/**
 * Same idea for the people-search flow.
 */
export async function importPeopleWithAiFilter(
  user: User,
  peopleFilters: ApolloPeopleFilters,
  opts: {
    target: number;
    aiFilter: AiFilter;
    promptOverride?: string;
    channel?: 'email' | 'linkedin';
  }
): Promise<ImportSummary & { pageWalk: PageWalkSummary }> {
  const channel = opts.channel ?? 'email';
  const ctx = buildContext(user, opts.promptOverride, channel);
  const itemLabel = channel === 'linkedin' ? 'LinkedIn message' : 'email';

  const jobId = await createJob({
    userId: user.id,
    kind: 'people_import',
    totalItems: opts.target,
    currentLabel:
      opts.aiFilter === 'any'
        ? `Generating ${opts.target} ${itemLabel}s…`
        : `Finding & generating ${opts.target} ${opts.aiFilter === 'no_ai' ? 'no-AI' : 'has-AI'} ${itemLabel}s…`,
    metadata: { channel },
  });
  ctx.jobId = jobId;

  try {
    const { summary, stats } = await walkAndImportPeople(
      user,
      ctx,
      peopleFilters,
      opts.target,
      opts.aiFilter,
      jobId
    );
    if (jobId) {
      await completeJob(jobId, {
        processedItems: summary.emailsGenerated,
        metadata: {
          channel,
          imported: summary.imported,
          emailsGenerated: summary.emailsGenerated,
          autoSent: summary.autoSent,
          detected: stats.detectionsRun,
          pages: stats.pagesScanned,
          rowsChecked: stats.apolloRowsScanned,
        },
      });
    }
    return { ...summary, pageWalk: stats };
  } catch (e) {
    if (jobId) await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    throw e;
  }
}
