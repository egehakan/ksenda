import prisma from "@/lib/prisma";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { generateNextFollowUp } from "@/lib/services/followup";
import {
  appendJobDetail,
  completeJob,
  createJob,
  failJob,
  updateJob,
} from "@/lib/services/jobs";

/**
 * Concurrent Gemini follow-up generations per run. Matches the app's
 * established generation envelope (PIPELINE_GEN_CONCURRENCY in
 * company-import): 3 stays well within the Gemini free-tier ~15 RPM cap
 * while being ~3× faster than the old strictly-serial loop.
 */
const FOLLOWUP_GEN_CONCURRENCY = 3;

/**
 * Follow-up generation. Finds every due company, then generates the next
 * follow-up for each via Gemini in a single step running a bounded
 * worker pool (FOLLOWUP_GEN_CONCURRENCY) — not per-item step.run, because
 * Inngest memoizes steps by deterministic order and cannot have steps
 * launched from racing concurrent workers. Long single steps are fine
 * (Vercel no longer caps Inngest duration) and retries:0 already. Each
 * completion bumps the job (progress + reaper heartbeat); one failing
 * follow-up is recorded and the batch keeps going.
 */
export const followupsProcess = inngest.createFunction(
  {
    id: "followups-process",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.followupsProcess }],
  },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };

    // Loaded inline — see comment in automation.ts on Date vs JsonifyObject.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    if (!user.geminiApiKey) throw new Error("Gemini API key not configured");

    // Same selection criteria as `processDueFollowUps`: contacted clients
    // whose nextFollowUpAt has elapsed and who haven't reached step 3.
    const candidates = await step.run("find-due", async () => {
      const rows = await prisma.company.findMany({
        where: {
          userId,
          clientStatus: "contacted",
          nextFollowUpAt: { lte: new Date() },
          followUpStep: { lt: 3 },
        },
        orderBy: { nextFollowUpAt: "asc" },
        take: 100,
        select: { id: true, name: true },
      });
      return rows;
    });

    if (candidates.length === 0) {
      // Still create a short-lived job so the UI shows a "nothing due"
      // tick rather than silence.
      const id = await createJob({
        userId,
        kind: "followup_process",
        totalItems: 0,
        currentLabel: "Nothing due.",
      });
      if (id) await completeJob(id, { processedItems: 0 });
      return;
    }

    const jobId = await step.run("create-job", async () => {
      const id = await createJob({
        userId,
        kind: "followup_process",
        totalItems: candidates.length,
        currentLabel: `Generating ${candidates.length} follow-up${candidates.length === 1 ? "" : "s"}…`,
      });
      if (!id) throw new Error("Failed to create job");
      return id;
    });

    try {
      const result = await step.run("generate-followups", async () => {
        let processed = 0;
        let generated = 0;
        let failed = 0;
        let idx = 0;

        const worker = async (): Promise<void> => {
          while (true) {
            // Sync read+increment — no await between them, so JS's
            // single-threaded model makes this claim race-free.
            const i = idx++;
            if (i >= candidates.length) return;
            const c = candidates[i];

            await appendJobDetail(jobId, { name: c.name, status: "generating" });
            let r: { success: boolean; error?: string };
            try {
              r = await generateNextFollowUp(userId, c.id);
            } catch (e) {
              r = {
                success: false,
                error: e instanceof Error ? e.message : "unknown",
              };
            }
            await appendJobDetail(jobId, {
              name: c.name,
              status: r.success ? "pending_review" : "failed",
              detail: r.success ? undefined : r.error,
            });

            processed++;
            if (r.success) generated++;
            else failed++;

            await updateJob(jobId, {
              processedItems: processed,
              currentLabel: `${generated} generated · ${processed}/${candidates.length}`,
            });
          }
        };

        await Promise.all(
          Array.from(
            { length: Math.min(FOLLOWUP_GEN_CONCURRENCY, candidates.length) },
            () => worker()
          )
        );
        return { processed, generated, failed };
      });

      await step.run("complete", async () => {
        await completeJob(jobId, {
          processedItems: result.processed,
          metadata: {
            generated: result.generated,
            failed: result.failed,
            total: candidates.length,
          },
        });
      });
    } catch (e) {
      await step.run("fail", async () => {
        await failJob(jobId, e instanceof Error ? e.message : "unknown");
      });
      throw e;
    }
  }
);
