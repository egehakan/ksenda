import { Inngest } from "inngest";

/**
 * Inngest client. All long-running operations (imports, bulk generation,
 * bulk sends, follow-up processing, automation orchestration) dispatch
 * events to this client; the handlers live in `src/inngest/functions/`
 * and are served via the `/api/inngest` route.
 *
 * Local dev: run `npx inngest-cli@latest dev` in a second terminal — it
 * auto-discovers the handler at http://localhost:3000/api/inngest.
 *
 * Production: set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel
 * env vars (https://app.inngest.com → Settings → Keys). Free tier covers
 * 50k function runs / month — plenty for current scale.
 */
export const inngest = new Inngest({
  id: "ksenda",
  // Force dev mode in non-prod so the SDK posts to the local Inngest dev
  // server (http://localhost:8288 by default). In production the SDK
  // reads INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY from env and talks to
  // Inngest Cloud. NODE_ENV is "production" on Vercel only.
  isDev: process.env.NODE_ENV !== "production",
});

/**
 * Strongly-typed event names. Use these to avoid drift between callers
 * and handlers.
 */
export const EVENTS = {
  pipelineProcessBatch: "pipeline/process-batch.requested",
  pipelineSendBatch: "pipeline/send-batch.requested",
  pipelineRetryBatch: "pipeline/retry-batch.requested",
  companiesImportBatch: "companies/import-batch.requested",
  peopleImportBatch: "people/import-batch.requested",
  followupsProcess: "followups/process.requested",
  automationRun: "automation/run.requested",
  companiesAiSearch: "companies/ai-search.requested",
  peopleAiSearch: "people/ai-search.requested",
} as const;
