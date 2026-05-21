import prisma from "@/lib/prisma";
import { inngest, EVENTS } from "@/lib/inngest/client";
import {
  importCompaniesForUser,
  importPeopleForUser,
} from "@/lib/services/company-import";
import type { ApolloCompany, ApolloPerson } from "@/lib/services/apollo";

/**
 * Bulk import of hand-selected Apollo rows (find contact → generate email).
 *
 * Runs the PIPELINED importer in a SINGLE step: `importCompaniesForUser` /
 * `importPeopleForUser` → `runInBatches` → `runImportPipeline`, which races
 * 6 find-contact workers feeding 3 Gemini workers (the proven free-tier
 * envelope) instead of the old strictly one-company-at-a-time loop. Those
 * helpers own the GenerationJob lifecycle (create → progress/heartbeat →
 * complete/fail) and the per-row finding_contact → generating →
 * pending_review detail trail.
 *
 * One step, no nested step.run — the pipeline is concurrent and Inngest
 * memoizes steps by deterministic order (it can't have steps started from
 * racing workers). Long single steps are fine (Vercel no longer caps
 * Inngest duration); `retries: 0` so a hard failure doesn't restart the
 * batch and double-generate.
 */

export const importCompaniesBatch = inngest.createFunction(
  {
    id: "companies-import-batch",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.companiesImportBatch }],
  },
  async ({ event, step }) => {
    const { userId, companies, customPrompt, jobId, channel } = event.data as {
      userId: string;
      companies: ApolloCompany[];
      customPrompt?: string;
      jobId?: string;
      channel?: "email" | "linkedin";
    };

    // Loaded inline (not via step.run) so Date fields stay as Date objects —
    // step.run JSON-serializes which would break buildContext's User type.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    if (!user.apolloApiKey || !user.geminiApiKey) {
      throw new Error("Apollo/Gemini API keys not configured");
    }

    // importCompaniesForUser fails its own job + rethrows on error, so a
    // throw here surfaces in Inngest with the job already marked failed.
    await step.run("import-pipeline", async () => {
      await importCompaniesForUser(user, companies, customPrompt, jobId, channel ?? "email");
    });
  }
);

export const importPeopleBatch = inngest.createFunction(
  {
    id: "people-import-batch",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.peopleImportBatch }],
  },
  async ({ event, step }) => {
    const { userId, people, customPrompt, jobId, channel } = event.data as {
      userId: string;
      people: ApolloPerson[];
      customPrompt?: string;
      jobId?: string;
      channel?: "email" | "linkedin";
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    if (!user.apolloApiKey || !user.geminiApiKey) {
      throw new Error("Apollo/Gemini API keys not configured");
    }

    await step.run("import-pipeline", async () => {
      await importPeopleForUser(user, people, customPrompt, jobId, channel ?? "email");
    });
  }
);
