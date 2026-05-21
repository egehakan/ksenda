/**
 * AI-suggest target titles for the current user's ICP.
 *
 *   POST /api/target-titles/suggest
 *
 * Reads the user's companyName + companyWebsite + geminiApiKey, hands them
 * to Gemini together with the full title catalog, and returns:
 *   {
 *     reasoning: "1-2 sentence ICP summary",
 *     titles: string[],          // ordered by priority, highest first
 *     custom: string[],          // any titles Gemini suggested that aren't
 *                                // in the catalog (rare, but allowed)
 *     trace: { fetchedUrls, searchQueries }
 *   }
 *
 * The user can apply the returned titles directly to their selection or
 * use them as a starting point and tweak before saving.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCurrentUser } from '@/lib/auth';
import { TARGET_TITLE_CATEGORIES } from '@/lib/constants';
import { getGroundingTools, extractGroundingTrace } from '@/lib/services/gemini-tools';

export const maxDuration = 300;

// Use the same Flash-Lite model the AI-presence detector uses — gives us
// urlContext + googleSearch with single-digit-second latency. The Pro model
// is overkill here: ICP-from-website is a short reasoning task, not a
// long-form generation. See ai-detector.ts for the verification probe that
// picked this model.
const SUGGEST_MODEL = 'gemini-3.1-flash-lite';

interface SuggestResult {
  reasoning?: string;
  titles?: unknown;
}

const ALL_CATEGORIES = Object.keys(TARGET_TITLE_CATEGORIES) as Array<
  keyof typeof TARGET_TITLE_CATEGORIES
>;

function buildPrompt(companyName: string, companyWebsite: string): string {
  // Embed the catalog as a flat numbered list grouped by category — gives
  // the model both structure (so it can reason "this is a sales play, pull
  // from Sales") and exact strings to copy.
  const catalogBlock = ALL_CATEGORIES.map((cat) => {
    return `## ${cat}\n${TARGET_TITLE_CATEGORIES[cat].map((t) => `- ${t}`).join('\n')}`;
  }).join('\n\n');

  return `ROLE
You are an expert B2B outbound strategist. The user is configuring a cold-email
pipeline and needs you to choose which JOB TITLES they should target at the
companies they sell to.

WHO YOU ARE WORKING FOR (the sender)
COMPANY_NAME: ${companyName}
COMPANY_WEBSITE: ${companyWebsite}

TOOLS AVAILABLE
- url-context: fetch the URL above. USE THIS FIRST. Read the homepage, the
  product / features page, the "About" page, and the "Customers" page if any.
- google-search: search the public web for recent news about ${companyName} —
  funding rounds, launches, hiring posts, podcast appearances. USE THIS SECOND.

REQUIRED RESEARCH STEPS (do them in this exact order)
1. Fetch ${companyWebsite} via url-context. Capture: what they sell, who buys
   it, what kind of company is a typical customer (size, industry, function),
   what business problem the product solves, and the price-tier signal (PLG /
   mid-market / enterprise).
2. Run ONE google-search for "${companyName}" + the most relevant operational
   signal (recent funding, recent launches, recent hiring). Note anything that
   sharpens the ICP picture.
3. From the catalog below, choose the 8-20 job titles that would be the
   highest-value decision-makers AT THE COMPANIES THIS USER SELLS TO. These
   are the people the user will be cold-emailing.
   - Order from highest priority first — most likely buyer/economic owner at
     the top.
   - DO NOT pick titles for the user's own company. Pick the buyer side.
   - Skip generic roles unless they are genuinely relevant to this ICP.
   - Prefer named seniority levels (CEO, VP, Head of, Director of) — avoid
     individual-contributor roles unless the product is explicitly bottom-up.

HONESTY RULE
Do not invent product details. If the website is sparse or down, lean on the
URL alone plus Google Search results, and say so briefly in the reasoning.

CATALOG (copy titles EXACTLY as shown — case-sensitive)

${catalogBlock}

OUTPUT
Return ONLY this JSON object, nothing else:
{
  "reasoning": "One or two sentences explaining the user's ICP and why these titles fit. Mention the most specific evidence you saw (e.g. a feature name, a customer logo, a funding round).",
  "titles": ["Title 1", "Title 2", "Title 3", "..."]
}

Titles MUST be exact strings from the catalog. If the user's product truly
calls for a role NOT in the catalog (rare), you may include it but keep it
short and specific (e.g. "VP of Customer Reliability"). Do not invent generic
filler. 8-20 titles total.`;
}

function parseSuggestion(text: string): SuggestResult | null {
  // The model is told to return ONLY a JSON object, but in practice it
  // sometimes wraps it in backticks or adds a one-liner before. Pull out
  // the first {...} block that has the two expected keys.
  const match = text.match(/\{[\s\S]*?"reasoning"[\s\S]*?"titles"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as SuggestResult;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(_request: NextRequest) {
  const t0 = Date.now();
  console.log('[suggest-titles] POST received');
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.geminiApiKey) {
      return NextResponse.json(
        {
          error: 'Gemini API key is required. Add it in the previous step before requesting AI suggestions.',
        },
        { status: 400 }
      );
    }

    if (!user.companyName || !user.companyWebsite) {
      return NextResponse.json(
        {
          error: 'Company name and website are required so Gemini knows whose ICP to model. Complete the Profile step first.',
        },
        { status: 400 }
      );
    }

    console.log(
      `[suggest-titles] calling Gemini for ${user.email} · company=${user.companyName} · website=${user.companyWebsite}`
    );

    const genAI = new GoogleGenerativeAI(user.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: SUGGEST_MODEL,
      tools: getGroundingTools(),
    });

    const prompt = buildPrompt(user.companyName, user.companyWebsite);

    let result: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      result = await model.generateContent(prompt);
    } catch (sdkError: unknown) {
      // The Gemini SDK throws a single `Error` with the upstream HTTP body
      // baked into `.message`. Pick out the well-known auth/quota cases so
      // the user gets a clear, actionable string instead of a 600-char dump.
      const raw = sdkError instanceof Error ? sdkError.message : String(sdkError);
      console.error(`[suggest-titles] Gemini SDK error (${Date.now() - t0}ms):`, raw);
      if (raw.includes('API_KEY_INVALID') || raw.includes('API key expired')) {
        return NextResponse.json(
          {
            error:
              'Your Gemini API key is invalid or expired. Update it in Settings → API keys and try again.',
          },
          { status: 400 }
        );
      }
      if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
        return NextResponse.json(
          {
            error:
              'Gemini quota exhausted on your key. Wait for the per-minute window to reset, or upgrade your AI Studio plan.',
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: `Gemini call failed: ${raw.slice(0, 240)}` },
        { status: 502 }
      );
    }

    const response = await result.response;
    const text = response.text();

    const trace = extractGroundingTrace(response);
    if (trace.fetchedUrls.length || trace.searchQueries.length) {
      console.log(
        `[suggest-titles] Grounding · fetched ${trace.fetchedUrls.length} URL(s), ` +
          `ran ${trace.searchQueries.length} search(es). ` +
          `Fetched: ${trace.fetchedUrls.join(', ') || '(none)'}. ` +
          `Searches: ${trace.searchQueries.join(' | ') || '(none)'}`
      );
    } else {
      console.warn('[suggest-titles] No grounding metadata returned.');
    }

    const parsed = parseSuggestion(text);
    if (!parsed || !Array.isArray(parsed.titles)) {
      return NextResponse.json(
        {
          error: 'Gemini returned an unexpected response. Try again, or pick titles manually.',
          rawResponse: text,
        },
        { status: 502 }
      );
    }

    // Split into catalog-matched vs custom so the picker can highlight both
    // streams correctly. Catalog match is case-sensitive — the prompt asks
    // for exact strings.
    const catalogAll = new Set<string>(
      ALL_CATEGORIES.flatMap((c) => TARGET_TITLE_CATEGORIES[c])
    );
    const cleanTitles: string[] = [];
    const customTitles: string[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.titles) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (catalogAll.has(t)) cleanTitles.push(t);
      else customTitles.push(t);
    }

    if (cleanTitles.length === 0 && customTitles.length === 0) {
      return NextResponse.json(
        {
          error: 'Gemini did not return any usable titles. Try again, or pick manually.',
          rawResponse: text,
        },
        { status: 502 }
      );
    }

    console.log(
      `[suggest-titles] success in ${Date.now() - t0}ms · ${cleanTitles.length} catalog + ${customTitles.length} custom`
    );

    return NextResponse.json({
      reasoning:
        typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
      titles: cleanTitles,
      custom: customTitles,
      trace,
    });
  } catch (error) {
    console.error('[suggest-titles] error:', error);
    const message =
      error instanceof Error ? error.message : 'AI suggestion failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
