/**
 * AI-presence detection. Cheap-and-batched.
 *
 * For each company (name + domain) we ask Gemini 2.5 Flash-Lite, with the
 * urlContext + googleSearch grounding tools, to decide whether the company
 * already deploys AI in its product or operations. Returns a 3-level
 * confidence verdict + evidence trail.
 *
 * Throughput:
 *   - Batch size 5: each Gemini call passes 5 companies × ~4 URLs each = 20
 *     URLs (urlContext's hard cap per call). Output is a JSON ARRAY of 5
 *     verdicts. ~$0.0018/company at 2.5 Flash-Lite pricing (May 2026).
 *   - Concurrency 4: up to 4 batched calls fly in parallel.
 *   - Cache: per (userId, domain). Cache hits skip Gemini entirely.
 *
 * Reliability:
 *   - Batched calls occasionally drop verdicts (Gemini sometimes skips URLs
 *     past ~10). Anything missing from the batched response gets retried as
 *     a solo call.
 *
 * The single-company public API (detectAiForTarget / detectAiForTargets) is
 * preserved for backwards-compatibility with the search-page "Check AI"
 * button and the per-row pipeline action.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGroundingTools, extractGroundingTrace } from './gemini-tools';
import prisma from '@/lib/prisma';

// Verification probe (scripts/verify-gemini-flash.ts, May 2026):
//   - gemini-3.1-flash-lite  : 1.7s, clean JSON, urlContext succeeds — fastest
//   - gemini-2.5-flash       : 5.3s, clean JSON, urlContext succeeds
//   - gemini-3-flash-preview : 12.9s, works but slower + costlier
//   - gemini-2.5-flash-lite  : 164s and ignored JSON-only instruction
//   - gemini-3-flash         : does not exist (404)
// → gemini-3.1-flash-lite picked: ~100× faster wall-clock than the
//   2.5-flash-lite we were using, still cheap ($0.25/$1.50 per 1M),
//   and respects structured-output instructions.
const DETECTION_MODEL = 'gemini-3.1-flash-lite';
const BATCH_SIZE = 5;
const DETECTION_CONCURRENCY = 4;

export type AiConfidence =
  | 'confirmed_has_ai'
  | 'probably_no_ai'
  | 'definitely_no_ai'
  | 'unknown';

export interface AiDetectionEvidence {
  type: string;
  url?: string;
  snippet: string;
}

export interface AiDetectionResult {
  domain: string;
  hasAi: boolean;
  confidence: AiConfidence;
  summary: string;
  evidence: AiDetectionEvidence[];
  operationalSignals: string[];
  fetchedUrls: string[];
  searchQueries: string[];
  checkedAt: string;
  rawResponse?: string;
  error?: string;
}

export interface DetectionTarget {
  name: string;
  domain: string;
  website?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeDomain(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();
}

function emptyResult(domain: string, error: string, summary?: string): AiDetectionResult {
  return {
    domain,
    hasAi: false,
    confidence: 'unknown',
    summary: summary || error,
    evidence: [],
    operationalSignals: [],
    fetchedUrls: [],
    searchQueries: [],
    checkedAt: new Date().toISOString(),
    error,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction (batched — N companies per call)
// ---------------------------------------------------------------------------

function buildBatchPrompt(targets: DetectionTarget[]): string {
  const companyBlocks = targets
    .map((t, i) => {
      const websiteUrl = t.website?.startsWith('http')
        ? t.website
        : `https://${t.domain}`;
      return `Company #${i + 1}
  name: ${t.name}
  domain: ${t.domain}
  website: ${websiteUrl}`;
    })
    .join('\n\n');

  const urlList = targets
    .map((t) => {
      const url = t.website?.startsWith('http') ? t.website : `https://${t.domain}`;
      return `  - ${url}
  - ${url.replace(/\/$/, '')}/careers`;
    })
    .join('\n');

  return `You are an AI-deployment auditor. Below are ${targets.length} companies. For EACH, decide whether the company already deploys AI in its product or operations as of today (2026).

COMPANIES
${companyBlocks}

TOOLS — USE BOTH
You have url-context (fetch URLs) and google-search (web search). DO NOT rely on training data.

REQUIRED RESEARCH STEPS — do them IN THIS ORDER
1. FIRST, use url-context to fetch ALL of these URLs. Read each page's text:
${urlList}

2. THEN run ONE google-search per company. Use queries like:
   - "<company name>" + (AI OR "artificial intelligence") site:<domain>
   - "<company name>" partnership (OpenAI OR Anthropic OR Microsoft AI)

3. Score each company strictly:

CONFIRMED_HAS_AI if ANY ONE is true:
  - Dedicated /ai or /our-ai or /copilot page exists with substantive product copy
  - Homepage hero / nav uses "AI", "AI-powered", "agentic" as a product attribute
  - Careers page lists open role for: ML Engineer, Applied Scientist, AI Engineer, Prompt Engineer, Head of AI/ML, Chief AI Officer
  - Press release in last 18 months: launched an AI product OR partnered with an AI vendor (OpenAI, Anthropic, Microsoft AI, Glean, Harvey, Sierra, etc.)
  - Public case study or product page names an AI vendor

PROBABLY_NO_AI if:
  - "AI" mentioned only as marketing fluff in a footer or hero subtitle, no product evidence
  - Single old blog post (>12 months) on AI, nothing since
  - Generic chatbot widget with menu-driven flows (NOT LLM-style free answers)
  - Salesforce Einstein / HubSpot Breeze badge but no product evidence

DEFINITELY_NO_AI if:
  - Zero AI references on site
  - Zero recent press on AI
  - No AI/ML roles on careers
  - No partnership with AI vendors

IGNORE these (do NOT count as has-AI):
  - "We use AI to filter spam" in privacy policy
  - "Smart X" product names (Smart Scheduling, Smart Routing)
  - "AI-powered" used once in footer with no product backing
  - Microsoft Copilot for M365 / Google Workspace Gemini (table stakes by 2026)
  - Shopify ML recommendations (Shopify's engine, not theirs)
  - Single sponsored Forbes "AI roundup" mention

ALSO EXTRACT per company:
  - One or two operationalSignals: real, observable pain hooks an outbound email could open with. Examples: "5 open AR Specialist roles", "manual claims appeals referenced on services page", "Q1 expansion into Texas".

OUTPUT FORMAT — return ONLY this JSON. No markdown fences. No preamble.
The "verdicts" array MUST contain exactly ${targets.length} objects, one per company IN THE ORDER GIVEN ABOVE.

{
  "verdicts": [
    {
      "company_index": 1,
      "domain": "${targets[0].domain}",
      "hasAi": true|false,
      "confidence": "confirmed_has_ai" | "probably_no_ai" | "definitely_no_ai",
      "summary": "1-2 sentence verdict, name the specific page or article driving the call",
      "evidence": [{"type": "site_page" | "careers_listing" | "press_release" | "partnership" | "blog_post" | "tech_stack", "url": "...", "snippet": "..."}],
      "operationalSignals": ["specific pain hook 1", "specific pain hook 2"]
    },
    ...
  ]
}

CRITICAL: hasAi must equal true if confidence is "confirmed_has_ai", false otherwise. evidence MUST cite URLs you actually fetched — never fabricate.`;
}

interface RawVerdict {
  company_index?: number;
  domain?: string;
  hasAi?: boolean;
  confidence?: string;
  summary?: string;
  evidence?: Array<{ type?: string; url?: string; snippet?: string }>;
  operationalSignals?: string[];
}

function parseBatchResponse(text: string): RawVerdict[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  // Find the first {...} that contains a "verdicts" array.
  const match = cleaned.match(/\{[\s\S]*"verdicts"[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { verdicts?: RawVerdict[] };
    return Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  } catch {
    return [];
  }
}

function normalizeVerdict(
  v: RawVerdict,
  fallback: DetectionTarget,
  fetchedUrls: string[],
  searchQueries: string[]
): AiDetectionResult {
  const conf: AiConfidence =
    v.confidence === 'confirmed_has_ai' ||
    v.confidence === 'probably_no_ai' ||
    v.confidence === 'definitely_no_ai'
      ? v.confidence
      : 'unknown';
  const hasAi = typeof v.hasAi === 'boolean' ? v.hasAi : conf === 'confirmed_has_ai';
  return {
    domain: normalizeDomain(v.domain || fallback.domain),
    hasAi,
    confidence: conf,
    summary: typeof v.summary === 'string' ? v.summary : '',
    evidence: Array.isArray(v.evidence)
      ? v.evidence
          .filter((e) => e && typeof e.snippet === 'string')
          .map((e) => ({
            type: typeof e.type === 'string' ? e.type : 'unknown',
            url: typeof e.url === 'string' ? e.url : undefined,
            snippet: e.snippet as string,
          }))
      : [],
    operationalSignals: Array.isArray(v.operationalSignals)
      ? v.operationalSignals.filter((s): s is string => typeof s === 'string')
      : [],
    fetchedUrls,
    searchQueries,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Single batched Gemini call
// ---------------------------------------------------------------------------

async function runBatchOnce(
  apiKey: string,
  targets: DetectionTarget[]
): Promise<Record<string, AiDetectionResult>> {
  if (targets.length === 0) return {};

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: DETECTION_MODEL,
    tools: getGroundingTools(),
  });

  const prompt = buildBatchPrompt(targets);
  let text = '';
  let trace = { fetchedUrls: [] as string[], searchQueries: [] as string[] };

  try {
    const generation = await model.generateContent(prompt);
    const response = await generation.response;
    text = response.text();
    trace = extractGroundingTrace(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    const out: Record<string, AiDetectionResult> = {};
    for (const t of targets) {
      out[normalizeDomain(t.domain)] = emptyResult(
        normalizeDomain(t.domain),
        `gemini call failed: ${msg}`
      );
    }
    return out;
  }

  const verdicts = parseBatchResponse(text);

  // Build a lookup by domain (preferred) and by 1-indexed company_index.
  const byDomain = new Map<string, RawVerdict>();
  const byIndex = new Map<number, RawVerdict>();
  for (const v of verdicts) {
    if (v.domain) byDomain.set(normalizeDomain(v.domain), v);
    if (typeof v.company_index === 'number') byIndex.set(v.company_index, v);
  }

  const out: Record<string, AiDetectionResult> = {};
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const dom = normalizeDomain(t.domain);
    const raw = byDomain.get(dom) ?? byIndex.get(i + 1);
    if (!raw) {
      // The model didn't return a verdict for this company. Caller is
      // responsible for retrying these solo. Mark unknown with no
      // persistence.
      out[dom] = emptyResult(dom, 'no verdict in batch response');
      continue;
    }
    out[dom] = normalizeVerdict(raw, t, trace.fetchedUrls, trace.searchQueries);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DetectOptions {
  geminiApiKey: string;
  userId: string;
  /** Force a fresh detection, skipping the cache. */
  force?: boolean;
}

export interface DetectStats {
  /** Companies served from the local AiDetectionCache — zero Gemini cost. */
  cacheHits: number;
  /** Companies that triggered an actual Gemini batched call. */
  geminiCallsCount: number;
}

/**
 * Batched detection over many targets. Each batch goes to one Gemini call.
 * Cache hits never reach Gemini. Misses are batched into groups of
 * BATCH_SIZE, run in parallel up to DETECTION_CONCURRENCY, and persisted
 * to the cache.
 *
 * Returns a record keyed by normalized domain.
 *
 * For backwards-compatibility, callers can still treat the return value as
 * a record (object spread / Object.entries). Use detectAiForTargetsWithStats
 * when you need the cache-hit/miss split — the walker uses this to bill
 * only real Gemini calls against the per-import detection budget.
 */
export async function detectAiForTargets(
  targets: DetectionTarget[],
  opts: DetectOptions
): Promise<Record<string, AiDetectionResult>> {
  const { results } = await detectAiForTargetsWithStats(targets, opts);
  return results;
}

export async function detectAiForTargetsWithStats(
  targets: DetectionTarget[],
  opts: DetectOptions
): Promise<{ results: Record<string, AiDetectionResult>; stats: DetectStats }> {
  const results: Record<string, AiDetectionResult> = {};
  const stats: DetectStats = { cacheHits: 0, geminiCallsCount: 0 };
  if (targets.length === 0) return { results, stats };

  // Dedupe inputs by normalized domain — many callers pass the same domain
  // multiple times (e.g. people-search where 8 people share an org).
  const uniqueByDomain = new Map<string, DetectionTarget>();
  for (const t of targets) {
    const dom = normalizeDomain(t.domain);
    if (!dom) continue;
    if (!uniqueByDomain.has(dom)) uniqueByDomain.set(dom, { ...t, domain: dom });
  }

  // Cache lookup (unless force).
  const toFetch: DetectionTarget[] = [];
  if (opts.force) {
    toFetch.push(...uniqueByDomain.values());
  } else {
    const domains = Array.from(uniqueByDomain.keys());
    const cached = await prisma.aiDetectionCache.findMany({
      where: { userId: opts.userId, domain: { in: domains } },
    });
    const cachedByDomain = new Map(cached.map((c) => [c.domain, c]));
    for (const [dom, t] of uniqueByDomain) {
      const hit = cachedByDomain.get(dom);
      if (hit) {
        try {
          results[dom] = JSON.parse(hit.resultJson) as AiDetectionResult;
          stats.cacheHits++;
          continue;
        } catch {
          // Fall through to refetch.
        }
      }
      toFetch.push(t);
    }
  }

  if (toFetch.length === 0) {
    return { results, stats };
  }

  stats.geminiCallsCount = toFetch.length;

  // Chunk into BATCH_SIZE groups and run with DETECTION_CONCURRENCY.
  const batches: DetectionTarget[][] = [];
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + BATCH_SIZE));
  }

  const dropoutTargets: DetectionTarget[] = [];

  let bi = 0;
  async function worker() {
    while (bi < batches.length) {
      const idx = bi++;
      const batch = batches[idx];
      try {
        const partial = await runBatchOnce(opts.geminiApiKey, batch);
        for (const t of batch) {
          const dom = normalizeDomain(t.domain);
          const r = partial[dom];
          if (!r || r.confidence === 'unknown') {
            // Treat as a dropout — retry solo at the end.
            dropoutTargets.push(t);
          } else {
            results[dom] = r;
          }
        }
      } catch (err) {
        for (const t of batch) {
          dropoutTargets.push(t);
        }
        console.error('[ai-detector] batch failed:', err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DETECTION_CONCURRENCY, batches.length) }, () =>
      worker()
    )
  );

  // Solo retry for dropouts (one-at-a-time, smaller payload often unblocks).
  for (const t of dropoutTargets) {
    const dom = normalizeDomain(t.domain);
    try {
      const partial = await runBatchOnce(opts.geminiApiKey, [t]);
      const r = partial[dom];
      results[dom] = r ?? emptyResult(dom, 'solo retry returned no verdict');
    } catch (err) {
      results[dom] = emptyResult(
        dom,
        err instanceof Error ? err.message : 'solo retry failed'
      );
    }
  }

  // Persist EVERY result, including "unknown". Persisting unknowns means a
  // re-run on the same search page doesn't burn another Gemini call on a
  // company we already failed to score — the matchesFilter logic correctly
  // excludes unknowns from both no_ai and has_ai gates, so this is safe.
  // The user can force a re-run via opts.force if they suspect a transient.
  const writable = Object.entries(results);
  if (writable.length > 0) {
    await Promise.all(
      writable.map(([dom, r]) =>
        prisma.aiDetectionCache
          .upsert({
            where: { userId_domain: { userId: opts.userId, domain: dom } },
            create: {
              userId: opts.userId,
              domain: dom,
              hasAi: r.hasAi,
              confidence: r.confidence,
              resultJson: JSON.stringify(r),
            },
            update: {
              hasAi: r.hasAi,
              confidence: r.confidence,
              resultJson: JSON.stringify(r),
              checkedAt: new Date(),
            },
          })
          .catch((err) => {
            console.warn('[ai-detector] cache write failed for', dom, err);
          })
      )
    );
  }

  return { results, stats };
}

/**
 * Detect AI for a single target. Convenience wrapper around
 * detectAiForTargets — same caching semantics.
 */
export async function detectAiForTarget(
  target: DetectionTarget,
  opts: DetectOptions
): Promise<AiDetectionResult> {
  const dom = normalizeDomain(target.domain);
  if (!dom) {
    return emptyResult('', 'missing domain');
  }
  const results = await detectAiForTargets([target], opts);
  return results[dom] ?? emptyResult(dom, 'no result returned');
}

/**
 * Look up a cached detection for a domain WITHOUT triggering Gemini.
 * Returns null if no cache exists. Used during company import to apply
 * detection that was already run on the search page.
 */
export async function getCachedDetectionByDomain(
  userId: string,
  domain: string
): Promise<AiDetectionResult | null> {
  const dom = normalizeDomain(domain);
  if (!dom) return null;
  const cached = await prisma.aiDetectionCache.findUnique({
    where: { userId_domain: { userId, domain: dom } },
  });
  if (!cached) return null;
  try {
    return JSON.parse(cached.resultJson) as AiDetectionResult;
  } catch {
    return null;
  }
}

/**
 * Returns true when this detection result matches the requested aiFilter.
 *   - 'any':     always true.
 *   - 'no_ai':   true if confidence is definitely_no_ai or probably_no_ai.
 *   - 'has_ai':  true if confidence is confirmed_has_ai.
 * 'unknown' never matches a non-'any' filter (so it's excluded from imports
 * — we'd rather miss a candidate than wrongly include one).
 */
export function detectionMatchesFilter(
  r: AiDetectionResult,
  filter: 'any' | 'no_ai' | 'has_ai'
): boolean {
  if (filter === 'any') return true;
  if (filter === 'no_ai') {
    return r.confidence === 'definitely_no_ai' || r.confidence === 'probably_no_ai';
  }
  return r.confidence === 'confirmed_has_ai';
}
