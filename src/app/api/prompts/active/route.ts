import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_LINKEDIN_INITIAL_PROMPT,
} from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

const ACTIVE_PROMPT_NAME = 'active_prompt';

function resolvePlatform(value: string | null): 'email' | 'linkedin' {
  return value === 'linkedin' ? 'linkedin' : 'email';
}

function defaultContentFor(platform: 'email' | 'linkedin'): string {
  return platform === 'linkedin' ? DEFAULT_LINKEDIN_INITIAL_PROMPT : DEFAULT_SYSTEM_PROMPT;
}

function descriptionFor(platform: 'email' | 'linkedin'): string {
  return platform === 'linkedin'
    ? 'Active prompt used for LinkedIn message generation'
    : 'Active prompt used for email generation';
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const platform = resolvePlatform(request.nextUrl.searchParams.get('platform'));

    let prompt = await prisma.prompt.findFirst({
      where: { userId: user.id, name: ACTIVE_PROMPT_NAME, platform },
    });

    if (!prompt) {
      prompt = await prisma.prompt.create({
        data: {
          userId: user.id,
          name: ACTIVE_PROMPT_NAME,
          platform,
          content: defaultContentFor(platform),
          description: descriptionFor(platform),
          isSystem: false,
          isActive: true,
        },
      });
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Error fetching active prompt:', error);
    return NextResponse.json({ error: 'Failed to fetch active prompt' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const platform = resolvePlatform(request.nextUrl.searchParams.get('platform'));

    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const existing = await prisma.prompt.findFirst({
      where: { userId: user.id, name: ACTIVE_PROMPT_NAME, platform },
    });

    const prompt = existing
      ? await prisma.prompt.update({
          where: { id: existing.id },
          data: { content },
        })
      : await prisma.prompt.create({
          data: {
            userId: user.id,
            name: ACTIVE_PROMPT_NAME,
            platform,
            content,
            description: descriptionFor(platform),
            isSystem: false,
            isActive: true,
          },
        });

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Error updating active prompt:', error);
    return NextResponse.json({ error: 'Failed to update active prompt' }, { status: 500 });
  }
}
