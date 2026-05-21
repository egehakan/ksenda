import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { proposeRecipes } from '@/lib/services/ai-recipe-generator';

export const maxDuration = 300;

/**
 * POST /api/automation/ai-setup/propose-recipes — asks Gemini to read
 * the user's company website and propose 4 Apollo search recipes. The
 * proposals are returned to the client for review and are NOT saved
 * until the user confirms via the save-recipes endpoint.
 *
 * Requires: companyWebsite + geminiApiKey set on the User row.
 *
 * Body (optional): { platform?: "email" | "linkedin" } — default "email".
 * When the smart-setup wizard runs in "both" mode it fires two parallel
 * calls, one per platform, and concatenates the proposal lists client-side.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({} as { platform?: string }));
    const platform: 'email' | 'linkedin' =
      body?.platform === 'linkedin' ? 'linkedin' : 'email';

    // Re-read user with the fields we need. The session payload may not
    // include the larger profile fields.
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        companyName: true,
        companyWebsite: true,
        geminiApiKey: true,
      },
    });
    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!profile.companyWebsite || !profile.companyWebsite.trim()) {
      return NextResponse.json(
        {
          error:
            'Add your company website in Settings → Account before running Smart Setup. AI needs it to understand your business.',
          missing: 'companyWebsite',
        },
        { status: 400 }
      );
    }
    if (!profile.geminiApiKey) {
      return NextResponse.json(
        {
          error:
            'Add your Gemini API key in Settings → API keys before running Smart Setup.',
          missing: 'geminiApiKey',
        },
        { status: 400 }
      );
    }

    // Hand the user's curated Target Titles to the recipe generator so
    // people-kind recipes draw from this list first (their ICP), instead of
    // inventing titles from scratch. Ordered by priority asc — the prompt
    // treats earlier entries as higher-priority buyers.
    const targetTitles = await prisma.targetTitle.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { priority: 'asc' },
      select: { title: true },
    });

    const result = await proposeRecipes({
      geminiApiKey: profile.geminiApiKey,
      companyName: (profile.companyName || '').trim() || 'your company',
      companyWebsite: profile.companyWebsite,
      targetTitles: targetTitles.map((t) => t.title),
      count: 4,
      platform,
    });

    return NextResponse.json({
      companyUnderstanding: result.companyUnderstanding,
      recipes: result.recipes,
      trace: result.trace,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('POST /api/automation/ai-setup/propose-recipes error:', error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
