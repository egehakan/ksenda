/**
 * Registry of all Inngest functions for Ksenda. The Inngest handler at
 * `/api/inngest` serves the union of these — add any new function to
 * the `functions` export below and Inngest will discover it on next
 * deploy.
 */
import { processBatch, retryBatch } from "./process-batch";
import { sendBatch } from "./send-batch";
import { importCompaniesBatch, importPeopleBatch } from "./imports";
import { followupsProcess } from "./followups";
import { automationRun } from "./automation";
import { companiesAiSearch, peopleAiSearch } from "./ai-search";

export const functions = [
  processBatch,
  retryBatch,
  sendBatch,
  importCompaniesBatch,
  importPeopleBatch,
  followupsProcess,
  automationRun,
  companiesAiSearch,
  peopleAiSearch,
];
