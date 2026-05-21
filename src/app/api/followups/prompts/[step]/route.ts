import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ step: string }>;
}

/**
 * PUT /api/followups/prompts/[step]?platform=email|linkedin — update the prompt
 * content or cadence for one step (1, 2, or 3) on the given platform.
 *
 * Body: { content?: string, name?: string, dayOffset?: number, isActive?: boolean }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { step } = await params;
    const stepNum = parseInt(step, 10);
    if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 3) {
      return NextResponse.json({ error: 'Step must be 1, 2, or 3' }, { status: 400 });
    }

    const platformParam = request.nextUrl.searchParams.get('platform') ?? 'email';
    const platform = platformParam === 'linkedin' ? 'linkedin' : 'email';

    const body = await request.json();
    const data: any = {};
    if (typeof body.content === 'string') data.content = body.content;
    if (typeof body.name === 'string') data.name = body.name;
    if (typeof body.dayOffset === 'number' && body.dayOffset > 0) data.dayOffset = body.dayOffset;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const prompt = await prisma.followUpPrompt.upsert({
      where: {
        userId_step_platform: { userId: user.id, step: stepNum, platform },
      },
      update: data,
      create: {
        userId: user.id,
        step: stepNum,
        platform,
        dayOffset: data.dayOffset ?? (stepNum === 1 ? 3 : stepNum === 2 ? 7 : 14),
        name: data.name ?? `Follow-up step ${stepNum}`,
        content: data.content ?? '',
        isActive: data.isActive ?? true,
      },
    });

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('PUT /api/followups/prompts/[step] error:', error);
    return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
  }
}
