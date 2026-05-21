import { inngest, EVENTS } from "@/lib/inngest/client";
import {
  processOneCompanyForGeneration,
  retryEmailGenerationForCompany,
} from "@/lib/services/process-company";
import {
  appendJobDetail,
  completeJob,
  failJob,
  updateJob,
} from "@/lib/services/jobs";

/**
 * Pipeline batches — per-item step.run() so each company is its own
 * Vercel function invocation. Total job time is unbounded (Inngest
 * re-invokes the parent across steps via memoization), so a 30-minute
 * job of 200 companies × ~10s each works without hitting any Vercel
 * timeout.
 *
 * Concurrency is keyed per-user so one tenant can't starve others.
 */

const BATCH_CONCURRENCY = { limit: 1 as const };

/** Pipeline: process every pending_generation company (or supplied IDs). */
export const processBatch = inngest.createFunction(
  {
    id: "pipeline-process-batch",
    concurrency: [
      { ...BATCH_CONCURRENCY, key: "event.data.userId" },
      { limit: 5 }, // global ceiling — matches Inngest free-tier cap (5)
    ],
    retries: 0,
    triggers: [{ event: EVENTS.pipelineProcessBatch }],
  },
  async ({ event, step }) => {
    const { userId, jobId, companyIds, customPrompt } = event.data as {
      userId: string;
      jobId: string;
      companyIds: string[];
      customPrompt?: string;
    };

    let processed = 0;
    let generated = 0;
    let noContact = 0;
    let errors = 0;

    try {
      for (const companyId of companyIds) {
        const result = await step.run(`process-${companyId}`, async () => {
          await appendJobDetail(jobId, {
            name: companyId,
            status: "generating",
          });
          const outcome = await processOneCompanyForGeneration({
            userId,
            companyId,
            customPrompt,
          });
          await appendJobDetail(jobId, {
            name: companyId,
            status:
              outcome.kind === "generated"
                ? "pending_review"
                : outcome.kind === "no_contact"
                  ? "failed"
                  : outcome.kind,
            detail:
              outcome.kind === "error"
                ? outcome.error
                : outcome.kind === "no_contact"
                  ? outcome.reason
                  : outcome.kind === "generated"
                    ? outcome.subject ?? undefined
                    : undefined,
          });
          return outcome;
        });

        processed++;
        if (result.kind === "generated") generated++;
        else if (result.kind === "no_contact") noContact++;
        else if (result.kind === "error") errors++;

        // Heartbeat + progress every item.
        await step.run(`progress-${processed}`, async () => {
          await updateJob(jobId, {
            processedItems: processed,
            currentLabel: `Processed ${processed}/${companyIds.length}`,
          });
        });
      }
      await step.run("complete", async () => {
        await completeJob(jobId, {
          processedItems: processed,
          metadata: { generated, noContact, errors, total: companyIds.length },
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

/** Pipeline: retry email generation for supplied EMAIL_NOT_GENERATED companies. */
export const retryBatch = inngest.createFunction(
  {
    id: "pipeline-retry-batch",
    concurrency: [
      { ...BATCH_CONCURRENCY, key: "event.data.userId" },
      { limit: 5 }, // global ceiling — matches Inngest free-tier cap
    ],
    retries: 0,
    triggers: [{ event: EVENTS.pipelineRetryBatch }],
  },
  async ({ event, step }) => {
    const { userId, jobId, companyIds, customPrompt } = event.data as {
      userId: string;
      jobId: string;
      companyIds: string[];
      customPrompt?: string;
    };

    let processed = 0;
    let generated = 0;
    let errors = 0;

    try {
      for (const companyId of companyIds) {
        const result = await step.run(`retry-${companyId}`, async () => {
          return retryEmailGenerationForCompany({
            userId,
            companyId,
            customPrompt,
          });
        });

        processed++;
        if (result.kind === "generated") generated++;
        else if (result.kind === "error") errors++;

        await step.run(`progress-${processed}`, async () => {
          await updateJob(jobId, {
            processedItems: processed,
            currentLabel: `Retried ${processed}/${companyIds.length}`,
          });
        });
      }
      await step.run("complete", async () => {
        await completeJob(jobId, {
          processedItems: processed,
          metadata: { generated, errors, total: companyIds.length },
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
