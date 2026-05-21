/**
 * POST /api/ai-detection/scan
 *
 * Run AI-presence detection on a list of (name, domain) targets. Used by the
 * Companies and People search pages BEFORE import — the user clicks "Check
 * AI status" on visible results and gets back a hasAi flag per target.
 *
 * Cache-backed. Subsequent calls for the same domain are served from cache.
 * Pass `force: true` to skip the cache.
 *
 * Body:
 *   {
 *     targets: [{ name, domain, website? }],
 *     force?: boolean
 *   }
 *
 * Returns:
 *   { results: Record<domain, AiDetectionResult> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { detectAiForTargets, type DetectionTarget } from '@/lib/services/ai-detector';

export const maxDuration = 300; // 5 minutes — Gemini grounding is slow

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.geminiApiKey) {
      return NextResponse.json(
        { error: 'Gemini API key is not configured. Please add it in Settings.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const targets: DetectionTarget[] = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length === 0) {
      return NextResponse.json({ error: 'No targets provided' }, { status: 400 });
    }
    if (targets.length > 50) {
      return NextResponse.json(
        { error: 'Up to 50 targets per call. Split into smaller batches.' },
        { status: 400 }
      );
    }

    const force = body.force === true;
    const cleanTargets = targets
      .map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        domain: typeof t.domain === 'string' ? t.domain : '',
        website: typeof t.website === 'string' ? t.website : undefined,
      }))
      .filter((t) => t.name && t.domain);

    const results = await detectAiForTargets(cleanTargets, {
      geminiApiKey: user.geminiApiKey,
      userId: user.id,
      force,
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[ai-detection/scan] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
