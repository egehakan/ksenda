/**
 * AI-driven recipe proposal.
 *
 * Reads the user's company info (name + website) and asks Gemini to:
 *   1. Fetch the website (urlContext grounding)
 *   2. Understand what the company does + who it sells to
 *   3. Propose 4 Apollo search recipes targeting distinct ideal prospect
 *      segments, with sensible filters, kinds, caps, and AI-presence
 *      gates.
 *
 * Returns proposals in our SavedSearch shape (minus code/userId). The
 * caller assigns auto-codes at save time so codes don't collide.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGroundingTools, extractGroundingTrace } from './gemini-tools';

// Same flash-lite model the AI detector uses — fast, cheap, respects
// JSON-only instructions. Recipe proposal is a one-shot per setup so
// throughput isn't a concern; latency is the user-visible metric.
const PROPOSAL_MODEL = 'gemini-3.1-flash-lite';

export type RecipeKind = 'companies' | 'people';
export type AiFilter = 'any' | 'no_ai' | 'has_ai';
export type Channel = 'email' | 'linkedin';

export interface ProposedRecipe {
  name: string;
  description: string;
  kind: RecipeKind;
  defaultDailyCap: number;
  filters: Record<string, unknown>;
  aiFilter: AiFilter;
  /** Outreach channel the recipe drives. The proposer stamps this from
   *  the platform option so the save route doesn't have to infer. */
  channel: Channel;
  rationale?: string;
}

export interface ProposalResult {
  companyUnderstanding: string;
  recipes: ProposedRecipe[];
  trace: { fetchedUrls: string[]; searchQueries: string[] };
}

export interface ProposalOptions {
  geminiApiKey: string;
  companyName: string;
  companyWebsite: string;
  /** The user's curated Target Titles list, highest priority first. The
   *  prompt tells Gemini to draw `titles` filters in people-kind recipes
   *  from this list first — users who refined their ICP titles upstream
   *  shouldn't have the wizard reinvent them. Empty array = no constraint. */
  targetTitles?: string[];
  /** How many recipes to propose. Defaults to 4. The prompt instructs
   *  Gemini to return exactly this many; we slice/pad on validation. */
  count?: number;
  /** Which outreach channel these recipes drive. Defaults to 'email'.
   *  When 'linkedin', the prompt branches to favor person-first targeting,
   *  LinkedIn-reachable buyer titles, and a lower default cap (15 vs 25)
   *  to reflect the manual-paste bottleneck. */
  platform?: Channel;
}

const ALLOWED_FILTER_KEYS = new Set([
  'locations',
  'organizationLocations',
  'personLocations',
  'industries',
  'keywords',
  'employeeCountMin',
  'employeeCountMax',
  'titles',
  'seniorities',
  'technologies',
]);

const VALID_AI_FILTERS: AiFilter[] = ['any', 'no_ai', 'has_ai'];

export async function proposeRecipes(opts: ProposalOptions): Promise<ProposalResult> {
  const count = opts.count ?? 4;
  const platform: Channel = opts.platform ?? 'email';
  const websiteUrl = normalizeWebsite(opts.companyWebsite);

  const prompt = buildProposalPrompt({
    companyName: opts.companyName,
    websiteUrl,
    count,
    targetTitles: opts.targetTitles ?? [],
    platform,
  });

  const genAI = new GoogleGenerativeAI(opts.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: PROPOSAL_MODEL,
    tools: getGroundingTools(),
  });

  let text = '';
  let trace = { fetchedUrls: [] as string[], searchQueries: [] as string[] };
  try {
    const generation = await model.generateContent(prompt);
    const response = await generation.response;
    text = response.text();
    trace = extractGroundingTrace(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    throw new Error(`Gemini call failed: ${msg}`);
  }

  const parsed = extractJsonObject(text);
  if (!parsed) {
    throw new Error(
      'AI returned an unreadable response. Try again — this usually works on retry.'
    );
  }

  const understanding =
    typeof parsed.companyUnderstanding === 'string'
      ? parsed.companyUnderstanding.trim()
      : '';

  const rawRecipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];
  const validated: ProposedRecipe[] = [];
  for (const r of rawRecipes) {
    const v = validateRecipe(r, platform);
    if (v) validated.push(v);
    if (validated.length >= count) break;
  }

  if (validated.length === 0) {
    throw new Error(
      'AI did not propose any usable recipes. Try again, or check your company website is reachable.'
    );
  }

  return {
    companyUnderstanding: understanding,
    recipes: validated,
    trace,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Prompt + parsing

function buildProposalPrompt(args: {
  companyName: string;
  websiteUrl: string;
  count: number;
  targetTitles: string[];
  platform: Channel;
}): string {
  // Render the user's curated ICP titles as a priority-ordered list block.
  // When the user has no saved titles, emit a "(none saved)" line and lift
  // the constraint so Gemini picks freely — preserves the original behavior
  // for fresh accounts that skip the title step.
  const titlesBlock =
    args.targetTitles.length > 0
      ? args.targetTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(none saved — pick freely from common buyer titles)';

  const titlesRule =
    args.targetTitles.length > 0
      ? `For every "people"-kind recipe, the "titles" filter MUST be drawn from the USER TARGET TITLES list above. Pick the subset of those titles that fits the recipe's segment — earlier entries in the list are higher priority for the user. You may add at most 1 extra title that is NOT in the list if it is essential for that specific segment and clearly missing; do not pad the array. NEVER replace the user's titles with invented ones.`
      : `The user has not saved a Target Titles list yet. Pick sensible buyer titles for each "people"-kind recipe.`;

  // LinkedIn outreach is person-first (you DM individuals, not companies)
  // and gated by manual paste effort. The cap guidance reflects 2026 safe-
  // ramp research: top performers sustain 50-75/day, but typical operators
  // cap at 15-20/day to stay sustainable + below LinkedIn's flagging
  // thresholds. The kind / cap / persona guidance differs from email; the
  // KEYWORDS RULE, TITLES RULE, and validation rules are shared.
  const channelGuidance =
    args.platform === 'linkedin'
      ? `OUTREACH CHANNEL — LinkedIn DMs (manual paste)
The generated recipes drive LinkedIn cold messages, not email. The sender will paste each message manually into LinkedIn after review. Therefore:
- Strongly prefer "people"-kind recipes. At least ${Math.max(3, args.count - 1)} of the ${args.count} recipes MUST be "kind": "people". LinkedIn outreach reaches individuals, not company inboxes.
- Favor buyer personas that are highly active and reachable on LinkedIn: founders, marketing leaders, growth leaders, content / community leaders, talent / recruiting leaders, product leaders. Less effective: legal, finance back-office, IT helpdesk.
- defaultDailyCap MUST be 10-20 (LinkedIn manual-paste bottleneck — each DM costs ~30s of human time, and LinkedIn flags accounts that send too much volume too fast). Use 15 as the typical value; go higher (up to 20) only for the simplest, fastest-to-paste recipes.
- The "personLocations" / "organizationLocations" filters still apply normally. "industries" works for people too via the organization-side join.`
      : `OUTREACH CHANNEL — Email (auto-sent via SMTP)
The generated recipes drive cold emails sent through the user's own SMTP provider after review. Mix "companies" and "people" kinds freely; the defaults below assume email volumes.`;

  return `You are helping a B2B sales operator design Apollo.io search recipes for a 30-day outbound campaign.

SENDER COMPANY
- Name: ${args.companyName}
- Website: ${args.websiteUrl}

USER TARGET TITLES (priority order, highest first)
${titlesBlock}

${channelGuidance}

STEP 1 — Read the website above using the urlContext tool. Understand what the company sells, who their ideal customer is, and what segments would convert best.

STEP 2 — Propose exactly ${args.count} Apollo search recipes. Each recipe must target a meaningfully different segment so the campaign doesn't saturate one slice.${
    args.platform === 'linkedin'
      ? ' Prioritize "people"-kind per the OUTREACH CHANNEL note above.'
      : ' Mix recipe "kind": include at least 2 "companies" recipes and at least 1 "people" recipe.'
  }

TITLES RULE
${titlesRule}

OUTPUT — return ONE valid JSON object. No markdown, no commentary, no code fences. Exact shape:

{
  "companyUnderstanding": "1-2 sentence summary of what ${args.companyName} does and who their ideal customer is.",
  "recipes": [
    {
      "name": "Short label, max 50 chars (e.g. 'Series A AI startups in EU')",
      "description": "1-2 sentences on why this segment converts for this business.",
      "kind": "companies" OR "people",
      "defaultDailyCap": integer ${args.platform === 'linkedin' ? 'between 10 and 20 (LinkedIn manual-paste cap — favor 15)' : 'between 10 and 30'},
      "filters": {
        // Include the keys that make sense; omit the rest. ALL OPTIONAL.
        "locations": ["United States", "United Kingdom"],       // companies-kind only — company HQ country/region
        "industries": ["Software", "Healthcare"],
        "keywords": ["fintech", "supply chain"],                // see KEYWORDS RULE below — use sparingly
        "employeeCountMin": 11,
        "employeeCountMax": 50,
        "titles": ["CEO", "Head of AI"],                        // people-kind only
        "seniorities": ["c_suite", "vp", "director", "head"],   // people-kind only — use Apollo's enum
        "organizationLocations": ["United States"],             // people-kind only — company HQ
        "personLocations": ["United States"],                   // people-kind only — person location
        "technologies": ["salesforce", "snowflake"]
      },
      "aiFilter": "any" OR "no_ai" OR "has_ai"
        // Use "no_ai" if this business sells AI to companies that don't yet use AI.
        // Use "has_ai" if this business sells to AI-native companies.
        // Use "any" if AI presence doesn't matter.
    }
    // ... ${args.count} total
  ]
}

KEYWORDS RULE (critical — read carefully)
- For "people"-kind recipes: DO NOT set "keywords". Apollo routes it through q_keywords as a strict free-text AND across the person's full profile text; combining it with titles/seniorities/locations almost always collapses the result set to 0. Trust the title + seniority + location filters alone.
- For "companies"-kind recipes: "keywords" is a list of Apollo organization keyword TAGS (e.g. "fintech", "supply chain", "logistics"). Each is a single tag; use widely-recognized industry/vertical terms only.
- When "aiFilter" is "has_ai" or "no_ai", the Gemini-driven gate enforces AI presence AFTER Apollo. NEVER also put AI-related terms ("AI", "Artificial Intelligence", "Machine Learning", "ML", "LLM", "GPT", "Generative AI", "Automation", "Deep Learning", "Neural Network") in "keywords" — that double-filter zeros out the search before the gate even runs.

VALIDATION RULES
- Each "name" must be ≤ 50 characters.
- defaultDailyCap must be ${args.platform === 'linkedin' ? '10-20' : '10-30'} (warmup-friendly volumes).
- Apollo seniority enum values: "owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern".
- Use real, well-known country/industry names. Avoid abbreviations except common ones (US, UK).
- DO NOT include any keys in "filters" other than: locations, organizationLocations, personLocations, industries, keywords, employeeCountMin, employeeCountMax, titles, seniorities, technologies.
- Output ONLY the JSON object. No prose before or after.
`;
}

/** Extract the first valid JSON object from Gemini's text response.
 *  Gemini sometimes wraps JSON in ```json fences or prepends a single
 *  word despite the "no markdown" instruction; this tolerates both. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Strip fence wrappers if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find the outermost {...} substring. Greedy match: from first { to
  // last }, then JSON.parse; if that fails, try shorter spans.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validate a single proposed recipe. Returns the normalized recipe on
 *  success, or null when it fails any required check. Coerces caps into
 *  range, drops unknown filter keys, normalizes kind/aiFilter. The
 *  channel is stamped from the platform input so the save route doesn't
 *  have to infer it. */
function validateRecipe(raw: unknown, platform: Channel): ProposedRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
  if (!name) return null;
  const description =
    typeof r.description === 'string' ? r.description.trim().slice(0, 280) : '';
  const kind: RecipeKind =
    r.kind === 'people' ? 'people' : r.kind === 'companies' ? 'companies' : 'companies';
  // LinkedIn cap ceiling is lower than email because each DM costs human
  // paste effort and LinkedIn flags accounts that send too much too fast.
  // Default 15 for LinkedIn (the user-confirmed mid-point of 10-20 safe-ramp
  // guidance from 2026 outreach research); 25 for email (unchanged).
  const cap =
    platform === 'linkedin'
      ? clampInt(r.defaultDailyCap, 5, 30, 15)
      : clampInt(r.defaultDailyCap, 10, 50, 25);
  const aiFilter: AiFilter = VALID_AI_FILTERS.includes(r.aiFilter as AiFilter)
    ? (r.aiFilter as AiFilter)
    : 'any';
  const rawFilters =
    r.filters && typeof r.filters === 'object'
      ? (r.filters as Record<string, unknown>)
      : {};
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawFilters)) {
    if (!ALLOWED_FILTER_KEYS.has(k)) continue;
    // Array fields: keep arrays of non-empty strings only.
    if (
      k === 'locations' ||
      k === 'organizationLocations' ||
      k === 'personLocations' ||
      k === 'industries' ||
      k === 'keywords' ||
      k === 'titles' ||
      k === 'seniorities' ||
      k === 'technologies'
    ) {
      if (Array.isArray(v)) {
        const cleaned = v
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim());
        if (cleaned.length > 0) filters[k] = cleaned;
      }
      continue;
    }
    // Numeric fields.
    if (k === 'employeeCountMin' || k === 'employeeCountMax') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) filters[k] = n;
      continue;
    }
  }
  // Safety net for the KEYWORDS RULE in the prompt — if the model ignores
  // it, strip the foot-guns server-side so the user doesn't end up with
  // recipes that import 0.
  //   1. People-kind: Apollo treats keywords as a free-text AND that
  //      over-narrows; drop them entirely.
  //   2. Any kind with an aiFilter gate: AI-related keywords double-filter
  //      and zero out the Apollo result before the gate runs; drop them.
  if (kind === 'people' && Array.isArray(filters.keywords)) {
    delete filters.keywords;
  }
  if (aiFilter !== 'any' && Array.isArray(filters.keywords)) {
    const safe = (filters.keywords as string[]).filter(
      (k) => !AI_KEYWORD_PATTERN.test(k)
    );
    if (safe.length > 0) filters.keywords = safe;
    else delete filters.keywords;
  }

  return {
    name,
    description,
    kind,
    defaultDailyCap: cap,
    filters,
    aiFilter,
    channel: platform,
    rationale:
      typeof r.rationale === 'string' ? r.rationale.trim().slice(0, 280) : undefined,
  };
}

/**
 * Keywords that overlap with the AI-presence gate. If `aiFilter` is set
 * to no_ai or has_ai, leaving any of these in the Apollo keyword filter
 * double-filters and zeros out the search before Gemini can score it.
 */
const AI_KEYWORD_PATTERN =
  /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llm|large language model|gpt|chatgpt|generative ai|gen ai|genai|deep learning|neural network|automation|autonomous|nlp|natural language)\b/i;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeWebsite(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
