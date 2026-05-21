/**
 * Browser helper: poll `/api/jobs/[id]` until the GenerationJob row reaches
 * a terminal state (`completed` or `failed`), then return the final job +
 * its parsed metadata. Used by AI-gated search flows that dispatch to
 * Inngest and need to wait for the run to finish before rendering results.
 *
 * Cheap defaults — 2s interval, 30 minute cap. Caller can override.
 */

export interface PolledJob {
  id: string;
  status: "running" | "completed" | "failed";
  totalItems: number;
  processedItems: number;
  currentLabel: string | null;
  error: string | null;
  metadata: unknown;
}

export async function pollJob(
  jobId: string,
  onTick?: (job: PolledJob) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<PolledJob> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 30 * 60 * 1000; // 30 min
  const startedAt = Date.now();

  while (true) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      // 404 right after dispatch can happen if the row isn't visible
      // yet — back off and try again briefly before giving up.
      if (res.status === 404 && Date.now() - startedAt < 10_000) {
        await sleep(interval);
        continue;
      }
      throw new Error(`Job lookup failed: ${res.status}`);
    }
    const { job } = (await res.json()) as { job: PolledJob };
    onTick?.(job);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    if (Date.now() - startedAt > timeout) {
      throw new Error("Job poll timed out");
    }
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
