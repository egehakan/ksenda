import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET /api/followups/prompts?platform=email|linkedin — list the user's 3
 * follow-up prompts for the given platform. When platform is omitted,
 * defaults to 'email' so existing UI callers continue to work.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const platformParam = request.nextUrl.searchParams.get('platform');
    const platform: 'email' | 'linkedin' =
      platformParam === 'linkedin' ? 'linkedin' : 'email';

    const prompts = await prisma.followUpPrompt.findMany({
      where: { userId: user.id, platform },
      orderBy: { step: 'asc' },
    });
    return NextResponse.json({ prompts, platform });
  } catch (error) {
    console.error('GET /api/followups/prompts error:', error);
    return NextResponse.json({ error: 'Failed to list follow-up prompts' }, { status: 500 });
  }
}
