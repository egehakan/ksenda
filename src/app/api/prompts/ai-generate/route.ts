/**
 * POST /api/prompts/ai-generate — generate the full 4-prompt outbound suite
 * (initial cold email + Day 3 / Day 7 / Day 14 follow-ups) for the current
 * user's company. Returns the prompts WITHOUT saving them. The client shows
 * them in a review dialog; the user accepts / edits / discards.
 *
 * Apply step is /api/prompts/ai-apply.
 *
 * Requires: companyName, companyWebsite, geminiApiKey on the User row.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { generatePromptSuite } from '@/lib/services/ai-prompt-generator';

export const maxDuration = 300;

/** Best-effort cal.com link extraction from the user's HTML signature.
 *  Falls back to undefined if no link is found, in which case the prompt
 *  template skips the calendar CTA. */
function extractCalendarLink(signature: string | null): string | undefined {
  if (!signature) return undefined;
  const m = signature.match(/https?:\/\/(?:cal\.com|calendly\.com|savvycal\.com)\/[^\s"'<>)]+/i);
  return m ? m[0] : undefined;
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  console.log('[ai-generate-prompts] POST received');
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({} as { platform?: string }));
    const platform: 'email' | 'linkedin' = body?.platform === 'linkedin' ? 'linkedin' : 'email';

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        companyName: true,
        companyWebsite: true,
        geminiApiKey: true,
        signature: true,
      },
    });
    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!profile.companyName || !profile.companyWebsite) {
      return NextResponse.json(
        {
          error: 'Company name and website are required so Gemini knows whose voice to model. Complete your Profile first.',
        },
        { status: 400 }
      );
    }
    if (!profile.geminiApiKey) {
      return NextResponse.json(
        { error: 'Add your Gemini API key in Settings → API keys before generating prompts.' },
        { status: 400 }
      );
    }

    console.log(
      `[ai-generate-prompts] calling Gemini for ${profile.email} · platform=${platform} · company=${profile.companyName} · website=${profile.companyWebsite}`
    );

    let result;
    try {
      result = await generatePromptSuite({
        geminiApiKey: profile.geminiApiKey,
        companyName: profile.companyName,
        companyWebsite: profile.companyWebsite,
        calendarLink: extractCalendarLink(profile.signature),
        platform,
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error(`[ai-generate-prompts] failed in ${Date.now() - t0}ms:`, raw);
      if (raw.includes('API_KEY_INVALID') || raw.includes('API key expired')) {
        return NextResponse.json(
          { error: 'Your Gemini API key is invalid or expired. Update it in Settings → API keys.' },
          { status: 400 }
        );
      }
      if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
        return NextResponse.json(
          { error: 'Gemini quota exhausted on your key. Wait a minute and retry.' },
          { status: 429 }
        );
      }
      if (
        raw.includes('INVALID_ARGUMENT') ||
        raw.includes('invalid argument') ||
        raw.includes('400 Bad Request')
      ) {
        // The service already auto-retried once. If we get here, Gemini is
        // consistently rejecting the request — usually clears within a minute
        // (cold tool-init or model-side transient). Surface a clear "try
        // again" message rather than the raw SDK dump.
        return NextResponse.json(
          {
            error:
              'Gemini rejected the request as a transient input-validation error (twice). This usually clears within a minute — click Regenerate to retry.',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: raw.slice(0, 280) }, { status: 502 });
    }

    console.log(
      `[ai-generate-prompts] success in ${Date.now() - t0}ms · ${result.blocks.modules.length} modules, ${result.blocks.credibilityMatrix.length} credibility rows, ${result.blocks.offerMatrix.length} offer rows`
    );

    return NextResponse.json({
      understanding: result.understanding,
      suite: result.suite,
      blocks: result.blocks,
      trace: result.trace,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('[ai-generate-prompts] error:', error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
