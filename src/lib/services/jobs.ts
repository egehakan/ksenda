/**
 * GenerationJob tracker. Long-running operations (imports, follow-up
 * generation, automation runs) record a row here so the frontend can show
 * live progress instead of a frozen spinner.
 *
 * Each helper is safe to fire-and-forget — if the DB write fails, the
 * caller's work continues. We never block real progress on telemetry.
 *
 * Heartbeat: every state mutation (createJob, updateJob, completeJob,
 * failJob) bumps `lastHeartbeatAt`. The reaper compares this against
 * `now()` instead of `startedAt`, so a 60-minute import that's still
 * making progress isn't killed at the 15-minute mark, and a job whose
 * process died gets reaped quickly (5 minutes of silence).
 */
import prisma from '@/lib/prisma';

export type JobKind =
  | 'company_import'
  | 'people_import'
  | 'company_search'
  | 'people_search'
  | 'followup_process'
  | 'automation_run'
  | 'single_generation'
  | 'pipeline_send';

export interface CreateJobOpts {
  userId: string;
  kind: JobKind;
  totalItems?: number;
  currentLabel?: string;
  metadata?: Record<string, unknown>;
}

export async function createJob(opts: CreateJobOpts): Promise<string | null> {
  try {
    const job = await prisma.generationJob.create({
      data: {
        userId: opts.userId,
        kind: opts.kind,
        totalItems: opts.totalItems ?? 0,
        currentLabel: opts.currentLabel ?? null,
        metadataJson: opts.metadata ? JSON.stringify(opts.metadata) : null,
        status: 'running',
        lastHeartbeatAt: new Date(),
      },
    });
    return job.id;
  } catch (e) {
    console.warn('[jobs] createJob failed:', e);
    return null;
  }
}

export async function updateJob(
  jobId: string | null,
  patch: { processedItems?: number; currentLabel?: string | null; totalItems?: number }
): Promise<void> {
  if (!jobId) return;
  try {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        processedItems: patch.processedItems,
        currentLabel: patch.currentLabel,
        totalItems: patch.totalItems,
        lastHeartbeatAt: new Date(),
      },
    });
  } catch (e) {
    console.warn('[jobs] updateJob failed:', e);
  }
}

export async function completeJob(
  jobId: string | null,
  opts: { processedItems?: number; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  if (!jobId) return;
  try {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        processedItems: opts.processedItems,
        currentLabel: null,
        metadataJson: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    });
  } catch (e) {
    console.warn('[jobs] completeJob failed:', e);
  }
}

export async function failJob(
  jobId: string | null,
  error: string
): Promise<void> {
  if (!jobId) return;
  try {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        error: error.slice(0, 500),
        currentLabel: null,
      },
    });
  } catch (e) {
    console.warn('[jobs] failJob failed:', e);
  }
}

/**
 * Append a single per-item progress event to a job. Concurrent-safe (one
 * INSERT per call, no JSON merge race). The widget's expanded card reads
 * these and shows them in reverse-chronological order.
 *
 * Status conventions:
 *   AI-detection: 'checking' | 'no_ai' | 'has_ai' | 'unknown_ai'
 *   Per-row import: 'finding_contact' | 'generating' | 'pending_review'
 *                   | 'sent' | 'failed'
 */
export async function appendJobDetail(
  jobId: string | null,
  entry: { name: string; status: string; detail?: string }
): Promise<void> {
  if (!jobId) return;
  try {
    await prisma.generationJobDetail.create({
      data: {
        jobId,
        name: entry.name.slice(0, 200),
        status: entry.status,
        detail: entry.detail?.slice(0, 300) ?? null,
      },
    });
    // Bump heartbeat so the reaper sees us as alive.
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { lastHeartbeatAt: new Date() },
    }).catch(() => {
      // Job may have been reaped / completed in a race — ignore.
    });
  } catch (e) {
    console.warn('[jobs] appendJobDetail failed:', e);
  }
}

/**
 * Sweep "running" jobs that haven't sent a heartbeat in the threshold
 * window. Healthy jobs bump the heartbeat from every updateJob call (every
 * batch or page-walk burst), so silence past the threshold means the
 * process died or hot-reloaded mid-flight.
 *
 * Default 5 minutes: tight enough that crashed jobs clear quickly, loose
 * enough that a single slow Gemini call within an otherwise-healthy job
 * doesn't trip it (the longest single grounded call I've measured is ~40s).
 *
 * Falls back to startedAt if lastHeartbeatAt is somehow null (defensive —
 * the schema column was added with a backfill, so this shouldn't fire).
 */
export async function reapStuckJobs(userId: string, olderThanMinutes = 5): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  try {
    // Read first so we know what we're reaping (and when each started) —
    // we need startedAt to scope the orphan-row cleanup below.
    const stuck = await prisma.generationJob.findMany({
      where: {
        userId,
        status: 'running',
        OR: [
          { lastHeartbeatAt: { lt: cutoff } },
          { lastHeartbeatAt: null, startedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, kind: true, startedAt: true },
    });
    if (stuck.length === 0) return;

    await prisma.generationJob.updateMany({
      where: { id: { in: stuck.map((j) => j.id) } },
      data: {
        status: 'failed',
        completedAt: new Date(),
        error: `No heartbeat for >${olderThanMinutes}m — process likely crashed or hot-reloaded mid-run. Reaped.`,
        currentLabel: null,
      },
    });

    // Release the recipe pool back. A killed run that had already started
    // page-walking will have upserted Company + FetchedOrganization rows
    // for every candidate it touched — including ones that NEVER produced
    // a draft (no contact / generation never reached). Those rows then
    // shadow the recipe forever, so the next run sees a shrunk pool. We
    // delete just the dead scrap (state == pending_generation or
    // email_not_generated) created inside the reaped job's time window
    // for kinds that touch the Company table. Successful drafts
    // (pending_review and onward) are kept — they're real work the user
    // can still review/send. Per-user Inngest concurrency of 1 means no
    // other run was writing for this user in that window, so the
    // time-window scope is safe.
    await cleanupReapedOrphans(userId, stuck);
  } catch (e) {
    console.warn('[jobs] reapStuckJobs failed:', e);
  }
}

const POLLUTING_KINDS = new Set<JobKind>([
  'automation_run',
  'company_import',
  'people_import',
]);
const DEAD_STATES = ['pending_generation', 'email_not_generated'];

/**
 * Delete partial Company + FetchedOrganization rows created by reaped
 * jobs that never produced a draft. Used by `reapStuckJobs` and by the
 * one-off recovery script for already-failed jobs.
 *
 * `jobs` is the set of jobs to clean up after; for each, all of the
 * caller's Company rows that (a) were created on/after that job's
 * startedAt and (b) are still in a no-draft state get deleted, along
 * with their matching FetchedOrganization entries. Skips kinds that
 * don't touch the Company table (search / followup / pipeline_send).
 */
export async function cleanupReapedOrphans(
  userId: string,
  jobs: Array<{ id: string; kind: JobKind | string; startedAt: Date }>
): Promise<{ companiesDeleted: number; fetchedDeleted: number }> {
  let companiesDeleted = 0;
  let fetchedDeleted = 0;
  for (const j of jobs) {
    if (!POLLUTING_KINDS.has(j.kind as JobKind)) continue;
    // Small backwards buffer in case row commits raced startedAt.
    const from = new Date(j.startedAt.getTime() - 30_000);
    try {
      const orphans = await prisma.company.findMany({
        where: {
          userId,
          createdAt: { gte: from },
          pipelineState: { in: DEAD_STATES },
        },
        select: { id: true, apolloId: true },
      });
      if (orphans.length === 0) continue;

      const apolloIds = orphans
        .map((o) => o.apolloId)
        .filter((x): x is string => !!x);

      const { count: cCount } = await prisma.company.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
      companiesDeleted += cCount;

      if (apolloIds.length > 0) {
        const { count: fCount } = await prisma.fetchedOrganization.deleteMany({
          where: { userId, apolloId: { in: apolloIds } },
        });
        fetchedDeleted += fCount;
      }
      console.log(
        `[reap-cleanup] job=${j.id} kind=${j.kind} released ${cCount} companies / ${apolloIds.length} fetched rows`
      );
    } catch (e) {
      console.warn(`[reap-cleanup] job=${j.id} cleanup failed:`, e);
    }
  }
  return { companiesDeleted, fetchedDeleted };
}

/**
 * Account-wide single-flight guard. Reaps stale jobs first (so a crashed
 * run never locks the account forever), then returns the oldest job
 * still `running` for this user — or null if the account is idle.
 *
 * Callers use this to hard-block starting a second search / generation /
 * automation run while one is in flight. Fails OPEN on a DB read error
 * (consistent with this module's "never block real work on telemetry"
 * rule) — the per-user Inngest concurrency of 1 is the backstop.
 */
export async function getActiveBlockingJob(
  userId: string
): Promise<{ id: string; kind: JobKind; currentLabel: string | null } | null> {
  await reapStuckJobs(userId);
  try {
    const job = await prisma.generationJob.findFirst({
      where: { userId, status: 'running' },
      orderBy: { startedAt: 'asc' },
      select: { id: true, kind: true, currentLabel: true },
    });
    if (!job) return null;
    return {
      id: job.id,
      kind: job.kind as JobKind,
      currentLabel: job.currentLabel,
    };
  } catch (e) {
    console.warn('[jobs] getActiveBlockingJob failed:', e);
    return null;
  }
}
