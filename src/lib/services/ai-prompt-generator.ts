/**
 * AI-driven generation of the full 4-prompt outbound suite (initial cold
 * email + Day 3 / Day 7 / Day 14 follow-ups) tailored to the user's company.
 *
 * Architecture: rather than asking Gemini to emit 40 KB of well-formed prose
 * across four prompts (fragile, large output, easy to corrupt JSON-escape
 * sequences), we ask it to emit a SMALL structured JSON of "building blocks"
 * — company positioning, 5-8 product modules, decision-matrix rows, Day-7
 * industry observations — extracted from the user's website + recent news.
 * A TypeScript template then assembles those blocks into the four full
 * production-grade prompts.
 *
 * This split has three benefits:
 *   1. Reliable output. JSON ~2-4 KB is hard to corrupt; 40 KB of prose is easy.
 *   2. Structural integrity. Every prompt always has the right sections
 *      (ROLE, benchmarks, FORBIDDEN list, output JSON spec) because the
 *      template controls them.
 *   3. Localized regenerate. If the user is unhappy with one block (say the
 *      offer matrix), we can re-prompt for just that piece without rebuilding
 *      everything.
 *
 * The output of this module mirrors the source prompts on
 * hakan@egehakankaraagac.com — same skeleton, same 2026-stack discipline,
 * same FORBIDDEN list, same length caps, same JSON output spec — but the
 * sender block, modules, and matrices are tenant-specific.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGroundingTools, extractGroundingTrace } from './gemini-tools';

const EXTRACTION_MODEL = 'gemini-3.1-flash-lite';

export interface PromptSuite {
  initial: string;
  day3: string;
  day7: string;
  day14: string;
}

export interface PromptSuiteResult {
  understanding: string;
  suite: PromptSuite;
  /** The raw building blocks Gemini returned. Surfaced so the host route
   *  can log them for debugging when a generation looks off. */
  blocks: ExtractedBlocks;
  trace: { fetchedUrls: string[]; searchQueries: string[] };
}

export interface PromptSuiteOptions {
  geminiApiKey: string;
  companyName: string;
  companyWebsite: string;
  /** Optional booking link. When set, the generated prompts will weave it
   *  into CTAs across all four prompts. When unset, the prompts use a
   *  generic "reply if interested" CTA. */
  calendarLink?: string;
  /** Outreach channel the generated suite targets. 'email' (default) emits
   *  the full email skeleton with subject + greeting + signature block.
   *  'linkedin' emits short DM-shaped prompts: no subject, no greeting,
   *  no sign-off, hard char caps, and a `{ "message": "..." }` output spec
   *  the runtime LinkedIn generator can parse. */
  platform?: 'email' | 'linkedin';
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks Gemini returns
// ─────────────────────────────────────────────────────────────────────────────

interface MatrixRow {
  /** Recipient-side signal — what the email writer saw on the prospect site. */
  ifYouSaw: string;
  /** Sender-side reply — credibility statement or offer they should make. */
  thenMention: string;
}

interface OfferRow {
  painPoint: string;
  concreteOffer: string;
}

interface Day7Row {
  signal: string;
  observation: string;
}

interface Module {
  name: string;
  /** 1-2 sentences with named tools/features pulled from the website. */
  description: string;
}

export interface ExtractedBlocks {
  understanding: string;
  audience: string;
  positioning: string;
  credibilityStack: string;
  modules: Module[];
  credibilityMatrix: MatrixRow[];
  offerMatrix: OfferRow[];
  day7Observations: Day7Row[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function generatePromptSuite(
  opts: PromptSuiteOptions
): Promise<PromptSuiteResult> {
  const websiteUrl = normalizeWebsite(opts.companyWebsite);
  const platform = opts.platform ?? 'email';

  const blocks = await extractBlocks({
    apiKey: opts.geminiApiKey,
    companyName: opts.companyName,
    websiteUrl,
  });

  // Same blocks (understanding, modules, matrices, day-7 menu) feed both
  // platforms. Only the wrapper templates differ — LinkedIn DMs drop the
  // subject/greeting/signature scaffolding and tighten word + char caps.
  const templateArgs: TemplateArgs = {
    companyName: opts.companyName,
    blocks: blocks.blocks,
    calendarLink: opts.calendarLink,
  };

  const suite: PromptSuite =
    platform === 'linkedin'
      ? {
          initial: buildLinkedInInitialPrompt(templateArgs),
          day3: buildLinkedInDay3Prompt(templateArgs),
          day7: buildLinkedInDay7Prompt(templateArgs),
          day14: buildLinkedInDay14Prompt(templateArgs),
        }
      : {
          initial: buildInitialPrompt(templateArgs),
          day3: buildDay3Prompt(templateArgs),
          day7: buildDay7Prompt(templateArgs),
          day14: buildDay14Prompt(templateArgs),
        };

  return {
    understanding: blocks.blocks.understanding,
    suite,
    blocks: blocks.blocks,
    trace: blocks.trace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — extract structured blocks from website + news
// ─────────────────────────────────────────────────────────────────────────────

async function extractBlocks(args: {
  apiKey: string;
  companyName: string;
  websiteUrl: string;
}): Promise<{
  blocks: ExtractedBlocks;
  trace: { fetchedUrls: string[]; searchQueries: string[] };
}> {
  const prompt = buildExtractionPrompt(args.companyName, args.websiteUrl);

  const genAI = new GoogleGenerativeAI(args.apiKey);
  const model = genAI.getGenerativeModel({
    model: EXTRACTION_MODEL,
    tools: getGroundingTools(),
  });

  // One-shot auto-retry on transient 400 "invalid argument" errors. Gemini
  // intermittently rejects requests at the input-validation layer (especially
  // during cold tool-init or concurrent-load spikes). The same prompt usually
  // succeeds on the next call within ~1-2 seconds. Distinguishable from
  // genuinely-malformed requests because the error reliably reproduces; we
  // err on retrying. Hard auth errors (API_KEY_INVALID) and quota errors
  // (RESOURCE_EXHAUSTED) are NOT retried — they need user action.
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isInvalidArg =
        raw.includes('INVALID_ARGUMENT') ||
        raw.includes('invalid argument') ||
        raw.includes('400 Bad Request');
      const isRetriable =
        isInvalidArg ||
        raw.includes('UNAVAILABLE') ||
        raw.includes('DEADLINE_EXCEEDED') ||
        raw.includes('INTERNAL');
      if (attempt === 0 && isRetriable) {
        console.warn(
          `[ai-prompt-generator] Gemini transient ${isInvalidArg ? 'INVALID_ARGUMENT' : 'error'} on first attempt, retrying once. Raw:`,
          raw.slice(0, 200)
        );
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  if (!result) {
    throw new Error('Gemini generation returned no result');
  }

  const response = await result.response;
  const text = response.text();
  const trace = extractGroundingTrace(response);

  const parsed = parseJsonObject(text);
  if (!parsed) {
    throw new Error(
      'AI returned an unreadable response. Try again — this usually works on retry.'
    );
  }

  const blocks = normalizeBlocks(parsed);
  if (blocks.modules.length === 0) {
    throw new Error(
      'AI did not produce a usable product description. Check your company website is reachable, then retry.'
    );
  }

  return { blocks, trace };
}

function buildExtractionPrompt(companyName: string, websiteUrl: string): string {
  return `ROLE
You research B2B companies and extract structured outbound-campaign building blocks. Your output becomes the foundation of cold-email + follow-up prompts.

TARGET COMPANY
- Name: ${companyName}
- Website: ${websiteUrl}

REQUIRED RESEARCH (do these in order)
1. Fetch ${websiteUrl} via url-context. Read the homepage plus ONE more page (product / about / customers / docs / pricing). Capture exactly what they sell, who their target customer is, and 5-8 specific product features or modules with names you can cite verbatim.
2. Run ONE google-search for "${companyName}" plus the strongest signal (funding, hiring, recent launch, partnership). Note one fresh-news anchor.

OUTPUT — return ONLY this JSON object. No markdown fences. No commentary.

{
  "understanding": "1-2 sentence summary of what ${companyName} does and who their ideal customer is. Specific to them, not generic.",
  "audience": "Short descriptor of the buyer persona this outbound campaign targets (e.g. 'marketing, content, and customer-experience leaders' or 'engineering and hiring leaders'). 6-10 words.",
  "positioning": "ONE sentence sender-side positioning in the voice of the sender, written as if they are quoting themselves. Max 40 words. Start with 'We' or the company name. Concrete, problem-first, no buzzwords.",
  "credibilityStack": "ONE sentence listing 2-4 specific credibility facts about ${companyName} (user count, customer count, scale, ARR signals, named integrations, named cohort logos). Only facts the website or recent news supports. If none are public, write 'production-grade SaaS in active development with paying customers' or similar — never invent numbers.",
  "modules": [
    {
      "name": "Specific module/product/feature name as listed on the site",
      "description": "1-2 sentences using NAMED tools and concrete details from the site. Include version numbers, integrations, throughput stats when public. Never invent."
    }
    // exactly 5 to 8 entries
  ],
  "credibilityMatrix": [
    {
      "ifYouSaw": "Concrete signal the email writer might spot on the prospect's site (chatbot, AI hiring, Cursor in JDs, heavy LLM usage, etc.)",
      "thenMention": "ONE sentence the email writer should drop in as credibility, drawing from the modules above. Names tools."
    }
    // exactly 5 to 7 entries — cover the highest-probability signals for ${companyName}'s ICP
  ],
  "offerMatrix": [
    {
      "painPoint": "Concrete pain point the writer might spot on the prospect's site",
      "concreteOffer": "ONE sentence describing a FREE, NAMED artifact ${companyName} can produce for this prospect. Specific deliverable, named tools, no fluff."
    }
    // exactly 5 to 7 entries — every offer must be free
  ],
  "day7Observations": [
    {
      "signal": "Concrete prospect-side signal",
      "observation": "1-2 sentences of 2026 industry intel relevant to that signal, framed as a peer-shared FYI. Cite specific numbers or named systems when truthful. Never invent metrics."
    }
    // exactly 5 to 7 entries — these are 'give without asking' value-adds for the Day 7 follow-up
  ]
}

RULES
- Every cited tool, integration, customer, or metric MUST come from the website or the google-search result. Never invent.
- Use 2026-current tool names (Claude Opus 4.7 / Sonnet 4.7 / Haiku 4.7, GPT-5, Gemini 3 Pro, Cursor, Claude Code, Cohere Rerank v4, Vapi, Braintrust, Langfuse, Portkey, MCP, LangGraph). Never use Claude 3.x, GPT-4o, Gemini 1.5/2, or any pre-2025 stack name.
- The matrices serve cold emails. Recipient-side signals should be things plausibly visible on a public B2B website. Sender-side replies should be 1-sentence statements that read like a senior peer, not an SDR.
- Output ONLY the JSON object. No prose before or after.`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1));
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeBlocks(raw: Record<string, unknown>): ExtractedBlocks {
  const understanding = asString(raw.understanding).trim();
  const audience = asString(raw.audience).trim() || 'B2B decision-makers';
  const positioning = asString(raw.positioning).trim();
  const credibilityStack = asString(raw.credibilityStack).trim();
  const modules = asArrayOfObjects(raw.modules)
    .map((m) => ({
      name: asString(m.name).trim(),
      description: asString(m.description).trim(),
    }))
    .filter((m) => m.name && m.description);
  const credibilityMatrix = asArrayOfObjects(raw.credibilityMatrix)
    .map((r) => ({
      ifYouSaw: asString(r.ifYouSaw).trim(),
      thenMention: asString(r.thenMention).trim(),
    }))
    .filter((r) => r.ifYouSaw && r.thenMention);
  const offerMatrix = asArrayOfObjects(raw.offerMatrix)
    .map((r) => ({
      painPoint: asString(r.painPoint).trim(),
      concreteOffer: asString(r.concreteOffer).trim(),
    }))
    .filter((r) => r.painPoint && r.concreteOffer);
  const day7Observations = asArrayOfObjects(raw.day7Observations)
    .map((r) => ({
      signal: asString(r.signal).trim(),
      observation: asString(r.observation).trim(),
    }))
    .filter((r) => r.signal && r.observation);
  return {
    understanding,
    audience,
    positioning,
    credibilityStack,
    modules,
    credibilityMatrix,
    offerMatrix,
    day7Observations,
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asArrayOfObjects(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object'
  );
}

function normalizeWebsite(input: string): string {
  const t = input.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — assemble the 4 prompts from blocks (TypeScript templates)
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateArgs {
  companyName: string;
  blocks: ExtractedBlocks;
  calendarLink?: string;
}

const PLACEHOLDER_BLOCK = `WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).`;

const TOOLS_BLOCK = `TOOLS AVAILABLE
url-context (fetch URLs in the prompt) and google-search (query the public web). Use both before writing. Training data alone cannot identify what their product actually does in 2026.`;

function renderModules(modules: Module[]): string {
  return modules
    .map((m) => `- ${m.name} — ${m.description}`)
    .join('\n\n');
}

function renderMatrix(rows: MatrixRow[]): string {
  const lines: string[] = [];
  lines.push('  IF YOU SAW                                              THEN MENTION');
  lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    lines.push(`  ${truncate(r.ifYouSaw, 52).padEnd(52)} → ${r.thenMention}`);
    lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  }
  return lines.join('\n');
}

function renderOfferMatrix(rows: OfferRow[]): string {
  const lines: string[] = [];
  lines.push('  PAIN POINT YOU SPOTTED                                CONCRETE OFFER');
  lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    lines.push(`  ${truncate(r.painPoint, 52).padEnd(52)} → ${r.concreteOffer}`);
    lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  }
  return lines.join('\n');
}

function renderDay7Menu(rows: Day7Row[]): string {
  const lines: string[] = [];
  lines.push('  WHAT YOU NOTICED ON THEIR SITE                       WHAT TO SHARE (1-2 sentences)');
  lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    lines.push(`  ${truncate(r.signal, 52).padEnd(52)} → "${r.observation}"`);
    lines.push('  ──────────────────────────────────────────────────────────────────────────────────────');
  }
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trim() + '…';
}

function ctaBlock(calendarLink: string | undefined, phrasings: string[]): string {
  if (calendarLink && calendarLink.trim()) {
    return phrasings
      .map((p, i) => `   (${String.fromCharCode(97 + i)}) "${p} ${calendarLink}"`)
      .join('\n');
  }
  return phrasings
    .map((p, i) => `   (${String.fromCharCode(97 + i)}) "${p.replace(/\s*$/, '')}"`)
    .join('\n');
}

function assetsBlock(args: TemplateArgs): string {
  const lines: string[] = [];
  if (args.calendarLink && args.calendarLink.trim()) {
    lines.push(`- Demo / call (15-min): ${args.calendarLink}`);
  }
  // We don't know the product URL absolutely, but the website is the closest stand-in.
  return lines.join('\n') || '- Reply to this email to book time.';
}

function buildInitialPrompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;

  return `ROLE
You are an expert at composing professional, effective B2B cold emails optimized for maximum reply rate from ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

REPLY-RATE BENCHMARKS YOU ARE OPTIMIZING FOR
- 2026 B2B average: 6-9 percent reply rate. Top performers: 14-18 percent.
- Signal-based emails (specific buying trigger referenced): 5-18 percent.
- Elite senders share three traits: under 80 words, single CTA, problem-first positioning.
- Personalization referencing the prospect's specific product, channel, or hiring posture: +30.5 percent lift.
- Subject line: 5 to 7 words wins over 5-9. Tight subjects beat clever ones.
- ${blocks.audience} scan for: stack-specific terminology they recognize, production proof, a concrete free artifact. Generic pitches die instantly.

WHO YOU ARE (the sender)
${companyName} — ${blocks.understanding}
Positioning: "${blocks.positioning}"
Credibility stack: ${blocks.credibilityStack}

PRODUCT MODULES (use only what's listed here; never invent modules, customers, or metrics outside this set)

${renderModules(blocks.modules)}

ASSETS YOU CAN OFFER
${assetsBlock(args)}

${PLACEHOLDER_BLOCK}

${TOOLS_BLOCK}

REQUIRED RESEARCH (do these in order before writing — non-negotiable)
1. Fetch COMPANY_WEBSITE_URL with url-context. Read the homepage plus ONE more page (product / docs / customers / careers / blog). Capture: what they actually ship, one specific feature you can reference by name, and any signal that maps to a row in the credibility matrix below.
2. Fetch SENDER_COMPANY_WEBSITE so you accurately represent the sender.
3. Run one google-search for "{{COMPANY_NAME}}" plus the strongest signal you spotted (funding, hiring, recent launch, partnership). Note one fresh, citeable thing.

EMAIL STRUCTURE — research-optimized for ${blocks.audience} reply rate

1. SUBJECT — 5 to 7 words. Names a CONCRETE artifact the recipient owns or a SPECIFIC system you noticed. No all caps. No emojis. No clickbait.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — ONE sentence. Names something specific you observed during research. Bridges from cold to conversation through THEIR reality, not your pitch.

4. BODY — Exactly TWO short paragraphs. Total body word count target: 40 to 60 words (entire email stays under 85 words including greeting and sign-off).

POINT 1 — Sender credibility, ONE sentence. Use this decision matrix to pick — match by what you SAW on their site:

${renderMatrix(blocks.credibilityMatrix)}

POINT 2 — Concrete observation tied to THEIR site + concrete free offer. 1 to 2 sentences. Name the specific system / page / feature on their site (use its actual name). Tie it to one 2026 production pain point. Then offer ONE named, free proof-of-work artifact:

${renderOfferMatrix(blocks.offerMatrix)}

The offer is always FREE. The offer is always NAMED — a specific artifact with named tools. Vague "I can help" reads as a 2024 SDR script and gets deleted.

5. CALL TO ACTION — ONE sentence. Rotate phrasings so different recipients see different versions:
${ctaBlock(args.calendarLink, ['Worth 15 min?', 'Happy to walk through it:', 'If easier to talk than type:'])}

6. CLOSING — "Best," on its own line, then {{SENDER_NAME}} on the next line. NOTHING after the name. No P.S. No soft opt-out.

TONE
Formal-but-warm. Confident, curious, peer-to-peer, slightly understated. Write like a senior peer reaching out to another senior peer, not like an SDR running a campaign. ${blocks.audience} smell scripts in two sentences. British understatement beats American hype.

LENGTH
TARGET: 60 to 80 words total from greeting through closing inclusive. Research shows elite senders cap under 80. Going longer hurts reply rate.

FORBIDDEN
- Words: "synergy", "leverage", "circle back", "innovative", "revolutionary", "cutting-edge", "game-changer", "best-in-class", "next-gen", "world-class", "in this competitive landscape", "I hope this finds you well", "just wanted to reach out", "quick question", "5 minutes of your time", "AI-powered" (used everywhere, dead).
- Outdated stack (signals a stale vendor): NEVER mention "GPT-4o", "GPT-4-turbo", "Claude 3", "Claude 3.5", "Claude 3.7", "Gemini 1.5", "Gemini 2", "Stable Diffusion XL", "Midjourney v5", "Pinecone-only retrieval". If you reference a model or tool, use the 2026 list in MODULES above.
- Service-tier words: "MVP", "Audit", "Retainer", "Consulting". Any price mention or seat count.
- Punctuation: em-dashes (use commas or parentheses instead), exclamation marks.
- Format: emojis, bullet points (short paragraphs only), P.S., double CTA.
- Honesty rule: only describe modules from MODULES above. You may confidently FRAME real modules. You may NOT invent customers, dates, or metrics outside the credibility stack listed.

OUTPUT FORMAT (return ONLY this JSON, nothing else):
{
  "subject": "Subject line, 5 to 7 words, specific to {{COMPANY_NAME}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — one sentence with a specific reference from their site]\\n\\n[Point 1 — credibility, one sentence with the matched module from the matrix, using 2026-current tool names]\\n\\n[Point 2 — concrete observation tied to a specific feature on their site, plus the named free offer]\\n\\n[CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`;
}

function buildDay3Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at composing professional, short follow-up emails to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the email below 3 days ago. The recipient has not replied. Write the first follow-up. This goes out in the SAME Gmail thread.

WHO YOU ARE
${companyName}. ${blocks.positioning}

${PLACEHOLDER_BLOCK}

ORIGINAL EMAIL (unanswered after 3 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

${TOOLS_BLOCK}

REQUIRED RESEARCH
1. Re-fetch {{COMPANY_WEBSITE_URL}} with url-context. Look specifically for what changed in the last few days — a new blog post, a new careers / engineering page, a product update, a press mention.
2. Run one google-search for "{{COMPANY_NAME}}" plus a fresh-signal keyword: "hiring", "announces", "launched", "raises". Last 3-7 days.

If you find something new, use it as the bump hook. If nothing changed, do a clean structural bump without faking specifics.

EMAIL STRUCTURE (bump variant)

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same subject prefixed with "Re:" so Gmail threads it under the original.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — Acknowledge the prior thread without overusing follow-up language. ONE sentence. Pattern options (vary):
   (a) "Bumping this in case it slipped past the inbox."
   (b) "Re-reading your [specific page on their site] reminded me I sent this last week."
   (c) "Saw [fresh news from research] and circled back."
   (d) "One quick add to the note below."

4. BODY — ONE key point. Max 2 short sentences. EITHER:
   (a) A new specific observation from your fresh research (something that landed this week — feature, hire, funding, post).
   (b) A one-line reinforcement of the angle from the original, phrased differently, with no re-pitching.
   Never re-list credentials. Never restate the original pitch in full.

5. CALL TO ACTION — One short line. Soft:
${ctaBlock(args.calendarLink, ['Calendar if easier:', 'Worth 15 min?', 'Or if my note isn\'t right, who on your team would be?'])}

6. CLOSING — "Best," on its own line, then {{SENDER_NAME}} on the next line. NOTHING after.

TONE
Professional. Treat the recipient as a busy peer who legitimately missed the first email.

LENGTH
25 to 50 words total. Shorter than the initial.

FORBIDDEN
- Phrases: "Just following up", "checking in", "wanted to make sure you saw this", "did you have a chance", "bumping this up", "any thoughts".
- Re-stating credentials or the original pitch in full.
- Outdated model / tool names (Claude 3.x, GPT-4o, GPT-4-turbo, Gemini 1.5/2). Use the 2026 stack only.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — bump or fresh-signal hook, one sentence]\\n\\n[Body — one new specific observation OR one-line reinforcement, max two sentences]\\n\\n[CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`;
}

function buildDay7Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at composing professional, value-driven follow-up emails to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial email 7 days ago. The recipient has not replied. Day 7 is the "give without asking" slot — the email reads like a peer sharing a useful observation, NOT another sales attempt. Sent in the same Gmail thread.

WHO YOU ARE
${companyName}. ${blocks.positioning}

${PLACEHOLDER_BLOCK}

ORIGINAL EMAIL (unanswered after 7 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

${TOOLS_BLOCK}

REQUIRED RESEARCH
1. Re-fetch their site looking for new pages, features, or content since the initial.
2. Run one google-search for a recent thing — "{{COMPANY_NAME}} announces" OR "{{COMPANY_NAME}} hiring" OR "{{COMPANY_NAME}} blog".

VALUE-ADD MENU — pick ONE 2026 industry observation that maps to what their product appears to use. The observation is the gift, not a pitch:

${renderDay7Menu(blocks.day7Observations)}

The observation is GIVING. It's a small piece of intel they probably didn't have, framed as "FYI" — not a service pitch.

EMAIL STRUCTURE

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same thread.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — ONE sentence that bridges to the value. Pattern options:
   (a) "Quick thought after seeing [specific thing from their site or fresh news]:"
   (b) "One more observation on [their feature] before I close this thread out:"
   (c) "Saw [recent activity] and circled back to the note below."

4. BODY — ONE key point from the value-add menu above. 1 to 2 sentences. No ask attached. Frame as peer-to-peer FYI.

5. CALL TO ACTION — Soft, optional:
${ctaBlock(args.calendarLink, ['Happy to talk through it:', 'Worth 15 min?'])}
   (c) Or skip the link and let the body itself be the soft CTA.

6. CLOSING — "Best," on its own line, then {{SENDER_NAME}}. NOTHING after.

TONE
Friendly, peer-to-peer. By Day 7 the recipient has seen your name twice.

LENGTH
40 to 70 words total. Shorter than the initial. Longer than the Day 3 bump.

FORBIDDEN
- Phrases: "Hope you don't mind another note", "wanted to share", "just in case you missed it", "thought you might find this useful" (too SDR-coded), "circling back", "touching base".
- Re-stating credentials or the original pitch.
- Outdated model / tool names. Reference current 2026 names only.
- Service-tier words ("MVP", "Audit", "Retainer", "Consulting"), price mentions.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — bridge to value, one sentence]\\n\\n[Body — one industry observation from the value-add menu, 1-2 sentences, framed as FYI]\\n\\n[CTA (optional)]\\n\\nBest,\\n{{SENDER_NAME}}"
}`;
}

function buildDay14Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at composing graceful break-up emails to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial email 14 days ago and two follow-ups since. The recipient has not replied. THIS IS THE FINAL EMAIL, no further follow-ups will be sent. The break-up has the highest reply rate of all follow-ups because it removes social pressure: the recipient can re-engage now or be left alone. Sent in the same Gmail thread.

WHO YOU ARE
${companyName}. ${blocks.positioning}

${PLACEHOLDER_BLOCK}

ORIGINAL EMAIL (unanswered after 14 days)
Subject: {{ORIGINAL_SUBJECT}}
Body:
{{ORIGINAL_BODY}}

${TOOLS_BLOCK}

Light touch — a single check for anything dramatically new at {{COMPANY_NAME}} (a new round, a major hire, a product launch). If you find one, you can acknowledge it gracefully ("congrats on the X, leaving the door open"). If not, just close the loop.

EMAIL STRUCTURE (break-up variant)

1. SUBJECT — "Re: {{ORIGINAL_SUBJECT}}". Same thread.

2. GREETING — "Hi {{CONTACT_FIRST_NAME}}," on its own line.

3. OPENING — ONE sentence that closes the loop gracefully without self-pity. Pattern options:
   (a) "Last note from me on this thread."
   (b) "Closing the file on this one for now."
   (c) "Should I assume the timing isn't right?"
   (d) If fresh activity: "Saw [their news], congrats. Last note from me before I close the file."

4. BODY — ONE short sentence. Make it easy for them to re-engage with a single yes or no:
   - Offer to circle back next quarter if priorities shift.
   - Acknowledge timing may simply be wrong.
   - Optionally ask if someone else on their team is the right contact (forward-friendly).

5. CALL TO ACTION — Optional. EITHER include the calendar as a door-open gesture, OR skip the link entirely:
${ctaBlock(args.calendarLink, ['Door\'s open:'])}
   (b) Or no link — let the body be the soft CTA.

6. CLOSING — "Best," on its own line, then {{SENDER_NAME}}. NOTHING after.

TONE
Friendly but final. Relaxed, non-needy, almost amused. The recipient should feel let off the hook, not guilt-tripped. ${blocks.audience} respect a clean exit.

LENGTH
25 to 50 words total.

FORBIDDEN
- Phrases: "Sorry to bother you", "I understand if you're not interested", "this is my last attempt", "no hard feelings".
- Self-pity. Guilt-trip phrasing. Any "I tried so hard" energy.
- Outdated model / tool names. Reference the 2026 stack only if you reference anything.
- Em-dashes, exclamation marks, emojis, P.S.

OUTPUT FORMAT (return ONLY this JSON):
{
  "subject": "Re: {{ORIGINAL_SUBJECT}}",
  "email_body": "Hi {{CONTACT_FIRST_NAME}},\\n\\n[Opening — graceful close, one sentence, optionally acknowledging fresh news]\\n\\n[Body — one short sentence, door-open framing]\\n\\n[Optional CTA]\\n\\nBest,\\n{{SENDER_NAME}}"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2b — LinkedIn DM templates
//
// Same building blocks the email templates use (modules, credibility matrix,
// offer matrix, day-7 observations), wrapped in a much tighter DM skeleton:
// no subject, no greeting, no sign-off, hard char caps, no links in the first
// touch, and a single-field `{ "message": "..." }` output spec so the
// generateLinkedInMessage parser can pick it up directly.
// ─────────────────────────────────────────────────────────────────────────────

const LI_PLACEHOLDER_BLOCK = `WHO YOU ARE WRITING TO
{{CONTACT_FIRST_NAME}} {{CONTACT_LAST_NAME}}, {{CONTACT_TITLE}} at {{COMPANY_NAME}} ({{COMPANY_WEBSITE_URL}}).`;

const LI_TOOLS_BLOCK = `TOOLS AVAILABLE
url-context (fetch URLs in the prompt) and google-search. Use both before writing — LinkedIn DMs reward specificity more than email because the recipient is one tap from your profile.`;

function buildLinkedInInitialPrompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;

  return `ROLE
You are an expert at writing short, high-reply LinkedIn cold messages optimized for ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

REPLY-RATE BENCHMARKS (2026 LinkedIn cold DMs)
- Top quartile clusters at 50 to 75 words. Mobile readers will not scroll.
- Signal-based DMs that reference a specific buying trigger reach 10 to 25 percent reply rates.
- Personalization that names the prospect's specific product, recent post, or hire: +30 percent lift.
- Single, frictionless ask wins. Multiple CTAs collapse reply rate.

WHO YOU ARE (the sender)
${companyName} — ${blocks.understanding}
Positioning: "${blocks.positioning}"
Credibility stack: ${blocks.credibilityStack}

PRODUCT MODULES (use only what's listed here; never invent modules, customers, or metrics)

${renderModules(blocks.modules)}

ASSETS YOU CAN OFFER
${assetsBlock(args)}

${LI_PLACEHOLDER_BLOCK}

${LI_TOOLS_BLOCK}

REQUIRED RESEARCH (do these in order before writing)
1. Fetch COMPANY_WEBSITE_URL with url-context. Read the homepage plus ONE more page (product / about / careers / blog). Capture one named feature you can reference verbatim AND any signal that maps to a row in the credibility matrix below.
2. Fetch SENDER_COMPANY_WEBSITE so you represent the sender accurately.
3. Run ONE google-search for "{{COMPANY_NAME}}" plus the strongest live signal (funding, hiring, recent launch, public post). Note one fresh, citeable thing.

CHANNEL CONTEXT
This is a LinkedIn DM, not an email. It will be pasted by the sender into a direct message, an InMail, or trimmed into a connection-request note. Write for the DM case; the recipient can see the sender's profile one tap away.

MESSAGE STRUCTURE (3 short sentences total)

1. OPENER — ONE sentence. Reference the specific signal you found on their site or in the search result. No greeting block — LinkedIn shows the recipient's name already. Pattern options:
   (a) "Saw [specific signal] — [one-line read on what it means]."
   (b) "Your [specific artifact on their site or recent post] caught me because [one-line reason]."
   (c) "[Compact observation about their stack, named feature, or recent activity]."

2. BRIDGE — ONE sentence. Connect the observation to a real, named thing you would build or notice for them. Use the credibility + offer matrices below to choose, match by what you SAW on their site:

CREDIBILITY MATRIX
${renderMatrix(blocks.credibilityMatrix)}

OFFER MATRIX (every offer is FREE and NAMED — never vague)
${renderOfferMatrix(blocks.offerMatrix)}

3. ASK — ONE sentence. Frictionless. Either a question they can answer in a single line OR a permission ask ("worth a 15-min swap if [their named priority] is on your radar?"). Never propose a meeting in the first DM unless the sender has an explicit calendar in WHO YOU ARE.

TONE
Peer-to-peer. Slightly understated. Confident. Reads like a senior practitioner sending one DM to one person, not like an SDR sequence. ${blocks.audience} smell scripts in two sentences.

LENGTH
50 to 90 words. Hard cap: 600 characters including spaces.

FORBIDDEN
- Greeting block ("Hi {{CONTACT_FIRST_NAME}},", "Hello", "Hey there"). LinkedIn already shows the name.
- Sign-off block ("Best,", "Regards,", "Cheers,", "{{SENDER_NAME}}"). DMs are not letters.
- Links of any kind. LinkedIn shadow-filters first-touch messages with URLs. The bridge mentions the offer; it does NOT link to it.
- Words: "synergy", "leverage", "circle back", "innovative", "revolutionary", "game-changer", "I hope this finds you well", "I am reaching out", "quick question", "5 minutes of your time", "thoughts?", "let me know", "AI-powered".
- Outdated stack: NEVER mention "GPT-4o", "GPT-4-turbo", "Claude 3", "Claude 3.5", "Claude 3.7", "Gemini 1.5", "Gemini 2", "Stable Diffusion XL", "Midjourney v5". If you reference a model, use the 2026 list in MODULES above (Claude Opus 4.7 / Sonnet 4.7 / Haiku 4.7, GPT-5, Gemini 3 Pro, Cursor, Claude Code, MCP, LangGraph, etc.).
- Punctuation: em-dashes (use commas or parentheses), exclamation marks, ellipses.
- Format: emojis, line breaks inside the message (LinkedIn collapses them), bullet points.
- Honesty rule: only describe modules from MODULES above. Never invent customers, metrics, or features outside the credibility stack.

OUTPUT FORMAT (return ONLY this JSON, nothing else):
{
  "message": "[50 to 90 words. Opener + bridge + ask. No greeting. No sign-off. No links.]"
}`;
}

function buildLinkedInDay3Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at writing short LinkedIn follow-up DMs to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the LinkedIn message below 3 days ago. The recipient has not replied. Write the first follow-up as a new DM in the same conversation (LinkedIn does not thread like email — each message stands alone but appears under the previous one).

WHO YOU ARE
${companyName}. ${blocks.positioning}

${LI_PLACEHOLDER_BLOCK}

ORIGINAL LINKEDIN MESSAGE (unanswered after 3 days)
{{ORIGINAL_BODY}}

${LI_TOOLS_BLOCK}

REQUIRED RESEARCH (light touch)
1. Re-fetch {{COMPANY_WEBSITE_URL}}. Look for what changed in the last 3 days — a new post, a new careers page, a feature ship, a press mention.
2. Run one google-search for "{{COMPANY_NAME}}" plus a fresh-signal keyword: "hiring", "announces", "launched", "raises". Last 3-7 days.

If you find something fresh, that's the bump hook. If not, do a clean structural bump without faking specifics.

MESSAGE STRUCTURE
Single short paragraph. Pattern options (pick the one that fits the situation):
(a) "Bumping this in case it slid past — [one new specific reason it's relevant]."
(b) "[One new specific observation from your fresh research], which made me circle back to my note above."
(c) "Realised I should have asked it differently: [reframed one-line question]."

End with the same low-friction ask as the original, phrased differently. No new pitch.

TONE
Light. Peer-to-peer. A real person noticing the silence without being annoyed about it.

LENGTH
20 to 45 words. Hard cap: 300 characters.

FORBIDDEN
- Phrases: "Just following up", "checking in", "wanted to make sure you saw this", "did you have a chance", "bumping this up to the top", "any thoughts".
- Re-stating credentials or the original pitch.
- Greeting block. Sign-off block. Sender name on a new line.
- Links. Em-dashes. Exclamation marks. Emojis.
- Outdated model / tool names. 2026 stack only.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[Single short paragraph, 20 to 45 words, with a varied one-line ask]"
}`;
}

function buildLinkedInDay7Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at writing value-driven LinkedIn DMs to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent the initial LinkedIn message 7 days ago and one nudge 4 days ago. Still no reply. This is the value-add slot — give them something useful with no ask attached. Day 7 on LinkedIn inverts the dynamic: you are no longer asking, you are giving.

WHO YOU ARE
${companyName}. ${blocks.positioning}

${LI_PLACEHOLDER_BLOCK}

ORIGINAL LINKEDIN MESSAGE (unanswered after 7 days)
{{ORIGINAL_BODY}}

${LI_TOOLS_BLOCK}

REQUIRED RESEARCH
1. Re-fetch their site looking for new pages, features, or content since the initial.
2. Run one google-search for a recent thing — "{{COMPANY_NAME}} announces" OR "{{COMPANY_NAME}} hiring" OR "{{COMPANY_NAME}} blog".

VALUE-ADD MENU — pick ONE 2026 industry observation that maps to what their product appears to use. The observation is the gift, not a pitch:

${renderDay7Menu(blocks.day7Observations)}

The observation is GIVING. A small piece of intel they probably didn't have, framed as FYI — not a service pitch.

MESSAGE STRUCTURE
Single paragraph.
1. ONE-line observation specific to them, drawn from your fresh research. Not a re-statement of anything in the original.
2. ONE concrete piece of value tied to that observation: a technical insight, a relevant public resource (a link is OK here — Day 7 is past the first-touch filter window), or a question that surfaces real expertise. NO ask attached to the value.
3. ONE optional, softer-than-before ask. If the sender has a calendar in WHO YOU ARE, you may include it. Otherwise let the message stand without an ask.

TONE
Warm. Confident. Reads like a peer sharing a thought, not an SDR closing a sequence.

LENGTH
35 to 70 words. Hard cap: 500 characters.

FORBIDDEN
- Phrases: "Hope you don't mind another note", "wanted to share", "just in case you missed it", "circling back one more time", "thought you might find this useful", "touching base".
- Re-stating credentials or original pitch.
- Greeting block. Sign-off block.
- Outdated model / tool names. 2026 stack only.
- Service-tier words ("MVP", "Audit", "Retainer", "Consulting"), price mentions.
- Em-dashes. Exclamation marks. Emojis.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[35 to 70 words, value-first, optional soft ask, no greeting, no sign-off]"
}`;
}

function buildLinkedInDay14Prompt(args: TemplateArgs): string {
  const { companyName, blocks } = args;
  return `ROLE
You are an expert at writing graceful LinkedIn break-up DMs to ${blocks.audience}. Write on behalf of {{SENDER_COMPANY_NAME}} ({{SENDER_COMPANY_WEBSITE}}).

CONTEXT
You sent three LinkedIn messages over the last 14 days. No reply. THIS IS THE FINAL DM — no further follow-ups will be sent. The break-up has the highest reply rate of the entire sequence because it removes social pressure: the recipient can re-engage now or be left alone forever.

WHO YOU ARE
${companyName}. ${blocks.positioning}

${LI_PLACEHOLDER_BLOCK}

ORIGINAL LINKEDIN MESSAGE (unanswered after 14 days)
{{ORIGINAL_BODY}}

${LI_TOOLS_BLOCK}

Light touch — a single check for anything dramatically new at {{COMPANY_NAME}} (a new round, a major hire, a product launch). If you find one, you can acknowledge it gracefully ("congrats on the X, leaving the door open"). If not, just close the loop.

MESSAGE STRUCTURE
Single short paragraph. Pick ONE pattern and adapt:
(a) "Closing the loop on this one — happy to circle back if [their named priority] becomes urgent."
(b) "Last note from me — if I am off on timing or fit, no offense taken. Door is open."
(c) "Should I assume timing is off? Forward-friendly if there is a better person on your side to talk to."
(d) If fresh activity: "Saw [their news], congrats. Last note from me — door open if priorities shift."

TONE
Relaxed. Non-needy. Almost amused. The recipient should feel let off the hook, not guilt-tripped. ${blocks.audience} respect a clean exit.

LENGTH
18 to 40 words. Hard cap: 280 characters.

FORBIDDEN
- Phrases: "Sorry to bother you", "I understand if you are not interested", "this is my last attempt", "no hard feelings".
- Self-pity. Guilt-trip phrasing. Apologising.
- Greeting block. Sign-off block.
- Links unless the sender has a calendar in WHO YOU ARE.
- Outdated model / tool names. 2026 stack only if you reference any.
- Em-dashes. Exclamation marks. Emojis.

OUTPUT FORMAT (return ONLY this JSON):
{
  "message": "[18 to 40 words, relaxed close, door-open framing]"
}`;
}
