import prisma from "@/lib/prisma";
import { inngest, EVENTS } from "@/lib/inngest/client";
import {
  searchCompanies,
  searchPeople,
  type ApolloCompany,
  type ApolloFilters,
  type ApolloPeopleFilters,
  type ApolloPerson,
} from "@/lib/services/apollo";
import {
  detectAiForTargetsWithStats,
  detectionMatchesFilter,
  normalizeDomain,
  type AiDetectionResult,
} from "@/lib/services/ai-detector";
import { orgKeyForPerson, type AiFilter } from "@/lib/services/company-import";
import {
  appendJobDetail,
  completeJob,
  failJob,
  updateJob,
} from "@/lib/services/jobs";

/**
 * AI-gated Apollo search — Inngest functions that walk Apollo pages and
 * run Gemini AI detection in CONCURRENT bursts. Each Apollo page fetch is
 * its own `step.run()`, and each burst of up to PER_PAGE_BURST companies
 * is detected in ONE `step.run()` via `detectAiForTargetsWithStats`
 * (internally ~20 concurrent flash-lite calls + per-domain cache) instead
 * of the old one-company-at-a-time serial loop. Total search time
 * unbounded (Vercel no longer caps Inngest step duration).
 *
 * Replaces the previous synchronous walker path in
 * /api/companies/search and /api/people/search which hit Vercel's 300s
 * cap on target≥50 AI-filtered searches.
 *
 * Results are stored on the GenerationJob's metadataJson so the
 * frontend can read them via `/api/jobs/[id]` once the job is done.
 *
 * Concurrency: limit 1 per user (one AI search at a time per tenant) +
 * global cap 5 to match free-tier limits.
 */

const PAGE_WALK_MAX = 4;
const APOLLO_PAGE_SIZE = 50;
const WALK_BUDGET = 200;
/** Companies detected per burst-step. The detector parallelizes these
 *  internally (BATCH_SIZE 5 × DETECTION_CONCURRENCY 4), so a burst of 10
 *  resolves ~10-wide instead of one-by-one. */
const PER_PAGE_BURST = 10;

/**
 * Detection budget for AI-gated search: the full WALK_BUDGET (200)
 * regardless of target. A target=10 search keeps checking up to 200
 * fresh companies looking for 10 matches, not 15 (target × 1.5) like the
 * older formula did. The walk still stops early once the target is hit
 * OR the 4-page Apollo window is exhausted.
 */

interface CompaniesSearchPayload {
  userId: string;
  jobId: string;
  filters: ApolloFilters;
  target: number;
  aiFilter: AiFilter;
}

interface PeopleSearchPayload {
  userId: string;
  jobId: string;
  filters: ApolloPeopleFilters;
  target: number;
  aiFilter: AiFilter;
}

export const companiesAiSearch = inngest.createFunction(
  {
    id: "companies-ai-search",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.companiesAiSearch }],
  },
  async ({ event, step }) => {
    const { userId, jobId, filters, target, aiFilter } =
      event.data as CompaniesSearchPayload;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    if (!user.apolloApiKey || !user.geminiApiKey) {
      await failJob(jobId, "Apollo + Gemini API keys required");
      return;
    }

    const fetchedIds = await step.run("load-fetched-ids", async () => {
      const rows = await prisma.fetchedOrganization.findMany({
        where: { userId },
        select: { apolloId: true },
      });
      return rows.map((r) => r.apolloId);
    });
    const fetchedSet = new Set(fetchedIds);

    const budget = WALK_BUDGET;
    const matches: ApolloCompany[] = [];
    const nonMatches: ApolloCompany[] = [];
    const detectionsByDomain: Record<string, AiDetectionResult> = {};

    let pagesScanned = 0;
    let apolloRowsScanned = 0;
    let alreadyImported = 0;
    let detectionsRun = 0;

    try {
      pageLoop: for (let page = 1; page <= PAGE_WALK_MAX; page++) {
        if (matches.length >= target) break;
        if (detectionsRun >= budget) break;

        const pageRows = await step.run(
          `page-${page}`,
          async (): Promise<ApolloCompany[]> => {
            const { companies } = await searchCompanies(
              user.apolloApiKey!,
              filters,
              page,
              APOLLO_PAGE_SIZE
            );
            return companies;
          }
        );
        pagesScanned++;
        apolloRowsScanned += pageRows.length;
        if (pageRows.length === 0) break;

        const fresh = pageRows.filter((c) => {
          const orgId = c.organization_id || c.id;
          if (orgId && fetchedSet.has(orgId)) {
            alreadyImported++;
            return false;
          }
          return !!(c.domain || c.primary_domain);
        });

        for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
          if (matches.length >= target) break pageLoop;
          if (detectionsRun >= budget) break pageLoop;
          const burst = fresh.slice(off, off + PER_PAGE_BURST);

          // One step per burst — the detector runs them ~20-wide
          // internally instead of one company at a time.
          const result = await step.run(
            `detect-p${page}-b${off}`,
            async (): Promise<{
              matched: ApolloCompany[];
              nonMatched: ApolloCompany[];
              detections: Record<string, AiDetectionResult>;
              geminiCalls: number;
            }> => {
              const withDom = burst
                .map((c) => ({
                  c,
                  dom: normalizeDomain(c.domain || c.primary_domain || ""),
                }))
                .filter((x) => !!x.dom);
              if (withDom.length === 0) {
                return {
                  matched: [],
                  nonMatched: [],
                  detections: {},
                  geminiCalls: 0,
                };
              }
              await Promise.all(
                withDom.map(({ c, dom }) =>
                  appendJobDetail(jobId, {
                    name: c.name,
                    status: "checking",
                    detail: dom,
                  })
                )
              );
              const { results: dets, stats } =
                await detectAiForTargetsWithStats(
                  withDom.map(({ c, dom }) => ({
                    name: c.name,
                    domain: dom,
                    website: c.website_url,
                  })),
                  { geminiApiKey: user.geminiApiKey!, userId }
                );
              const matched: ApolloCompany[] = [];
              const nonMatched: ApolloCompany[] = [];
              const detections: Record<string, AiDetectionResult> = {};
              for (const { c, dom } of withDom) {
                const det = dets[dom];
                if (!det) continue;
                detections[dom] = det;
                const verdictStatus =
                  det.confidence === "confirmed_has_ai"
                    ? "has_ai"
                    : det.confidence === "unknown"
                      ? "unknown_ai"
                      : "no_ai";
                await appendJobDetail(jobId, {
                  name: c.name,
                  status: verdictStatus,
                  detail: det.summary?.slice(0, 200),
                });
                if (detectionMatchesFilter(det, aiFilter)) matched.push(c);
                else nonMatched.push(c);
              }
              return {
                matched,
                nonMatched,
                detections,
                geminiCalls: stats.geminiCallsCount,
              };
            }
          );

          detectionsRun += result.geminiCalls;
          Object.assign(detectionsByDomain, result.detections);
          for (const c of result.matched) matches.push(c);
          for (const c of result.nonMatched) nonMatches.push(c);

          await step.run(`progress-p${page}-b${off}`, async () => {
            await updateJob(jobId, {
              processedItems: matches.length,
              currentLabel: `Detecting · page ${page} · ${matches.length}/${target} matches · ${detectionsRun} checked`,
            });
          });
        }
      }

      const trimmedMatches = matches.slice(0, target);
      const checked = [...trimmedMatches, ...nonMatches];

      await step.run("persist-result", async () => {
        await completeJob(jobId, {
          processedItems: trimmedMatches.length,
          metadata: {
            mode: "ai_gated_companies",
            target,
            aiFilter,
            matches: trimmedMatches,
            checked,
            aiDetections: detectionsByDomain,
            stats: {
              target,
              pagesScanned,
              apolloRowsScanned,
              matchesFound: trimmedMatches.length,
              alreadyImported,
              detectionsRun,
            },
          },
        });
      });
    } catch (e) {
      await step.run("fail", async () => {
        await failJob(jobId, e instanceof Error ? e.message : "search failed");
      });
      throw e;
    }
  }
);

export const peopleAiSearch = inngest.createFunction(
  {
    id: "people-ai-search",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.peopleAiSearch }],
  },
  async ({ event, step }) => {
    const { userId, jobId, filters, target, aiFilter } =
      event.data as PeopleSearchPayload;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    if (!user.apolloApiKey || !user.geminiApiKey) {
      await failJob(jobId, "Apollo + Gemini API keys required");
      return;
    }

    const fetchedIds = await step.run("load-fetched-ids", async () => {
      const rows = await prisma.fetchedOrganization.findMany({
        where: { userId },
        select: { apolloId: true },
      });
      return rows.map((r) => r.apolloId);
    });
    const fetchedSet = new Set(fetchedIds);

    const budget = WALK_BUDGET;
    const matches: ApolloPerson[] = [];
    const nonMatches: ApolloPerson[] = [];
    const seenOrgDomain = new Set<string>();
    const detectionsByDomain: Record<string, AiDetectionResult> = {};

    let pagesScanned = 0;
    let apolloRowsScanned = 0;
    let alreadyImported = 0;
    let detectionsRun = 0;

    try {
      pageLoop: for (let page = 1; page <= PAGE_WALK_MAX; page++) {
        if (matches.length >= target) break;
        if (detectionsRun >= budget) break;

        const pageRows = await step.run(
          `page-${page}`,
          async (): Promise<ApolloPerson[]> => {
            const { people } = await searchPeople(
              user.apolloApiKey!,
              filters,
              page,
              APOLLO_PAGE_SIZE
            );
            return people;
          }
        );
        pagesScanned++;
        apolloRowsScanned += pageRows.length;
        if (pageRows.length === 0) break;

        const fresh = pageRows.filter((p) => {
          const orgKey = orgKeyForPerson(p);
          if (orgKey && fetchedSet.has(orgKey)) {
            alreadyImported++;
            return false;
          }
          const dom = normalizeDomain(
            p.organization?.primary_domain || p.organization?.domain
          );
          if (!dom) return false;
          if (seenOrgDomain.has(dom)) return false;
          seenOrgDomain.add(dom);
          return true;
        });

        for (let off = 0; off < fresh.length; off += PER_PAGE_BURST) {
          if (matches.length >= target) break pageLoop;
          if (detectionsRun >= budget) break pageLoop;
          const burst = fresh.slice(off, off + PER_PAGE_BURST);

          // One step per burst — the detector runs them ~20-wide
          // internally instead of one org at a time.
          const result = await step.run(
            `detect-p${page}-b${off}`,
            async (): Promise<{
              matched: ApolloPerson[];
              nonMatched: ApolloPerson[];
              detections: Record<string, AiDetectionResult>;
              geminiCalls: number;
            }> => {
              const withDom = burst
                .map((p) => ({
                  p,
                  dom: normalizeDomain(
                    p.organization?.primary_domain ||
                      p.organization?.domain ||
                      ""
                  ),
                }))
                .filter((x) => !!x.dom);
              if (withDom.length === 0) {
                return {
                  matched: [],
                  nonMatched: [],
                  detections: {},
                  geminiCalls: 0,
                };
              }
              await Promise.all(
                withDom.map(({ p, dom }) =>
                  appendJobDetail(jobId, {
                    name: p.organization?.name || dom,
                    status: "checking",
                    detail: dom,
                  })
                )
              );
              const { results: dets, stats } =
                await detectAiForTargetsWithStats(
                  withDom.map(({ p, dom }) => ({
                    name: p.organization?.name || dom,
                    domain: dom,
                    website: p.organization?.website_url,
                  })),
                  { geminiApiKey: user.geminiApiKey!, userId }
                );
              const matched: ApolloPerson[] = [];
              const nonMatched: ApolloPerson[] = [];
              const detections: Record<string, AiDetectionResult> = {};
              for (const { p, dom } of withDom) {
                const det = dets[dom];
                if (!det) continue;
                detections[dom] = det;
                const verdictStatus =
                  det.confidence === "confirmed_has_ai"
                    ? "has_ai"
                    : det.confidence === "unknown"
                      ? "unknown_ai"
                      : "no_ai";
                await appendJobDetail(jobId, {
                  name: p.organization?.name || dom,
                  status: verdictStatus,
                  detail: det.summary?.slice(0, 200),
                });
                if (detectionMatchesFilter(det, aiFilter)) matched.push(p);
                else nonMatched.push(p);
              }
              return {
                matched,
                nonMatched,
                detections,
                geminiCalls: stats.geminiCallsCount,
              };
            }
          );

          detectionsRun += result.geminiCalls;
          Object.assign(detectionsByDomain, result.detections);
          for (const p of result.matched) matches.push(p);
          for (const p of result.nonMatched) nonMatches.push(p);

          await step.run(`progress-p${page}-b${off}`, async () => {
            await updateJob(jobId, {
              processedItems: matches.length,
              currentLabel: `Detecting · page ${page} · ${matches.length}/${target} matches · ${detectionsRun} checked`,
            });
          });
        }
      }

      const trimmedMatches = matches.slice(0, target);
      const checked = [...trimmedMatches, ...nonMatches];

      await step.run("persist-result", async () => {
        await completeJob(jobId, {
          processedItems: trimmedMatches.length,
          metadata: {
            mode: "ai_gated_people",
            target,
            aiFilter,
            matches: trimmedMatches,
            checked,
            aiDetections: detectionsByDomain,
            stats: {
              target,
              pagesScanned,
              apolloRowsScanned,
              matchesFound: trimmedMatches.length,
              alreadyImported,
              detectionsRun,
            },
          },
        });
      });
    } catch (e) {
      await step.run("fail", async () => {
        await failJob(jobId, e instanceof Error ? e.message : "search failed");
      });
      throw e;
    }
  }
);
