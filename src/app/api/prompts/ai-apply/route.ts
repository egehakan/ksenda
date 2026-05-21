/**
 * POST /api/prompts/ai-apply — persists prompts the user reviewed from the
 * /api/prompts/ai-generate dialog. Accepts any subset of:
 *   { initial?: string, day3?: string, day7?: string, day14?: string }
 * Upserts the active_prompt row plus the matching FollowUpPrompt step for
 * each slot the body contains. Empty / missing slots are left untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface ApplyBody {
  initial?: string;
  day3?: string;
  day7?: string;
  day14?: string;
  /** Platform the AI generated for; defaults to 'email'. */
  platform?: 'email' | 'linkedin';
}

function metaForPlatform(platform: 'email' | 'linkedin') {
  if (platform === 'linkedin') {
    return {
      day3: { step: 1, dayOffset: 3, name: 'Day 3 · LinkedIn nudge' },
      day7: { step: 2, dayOffset: 7, name: 'Day 7 · LinkedIn value-add' },
      day14: { step: 3, dayOffset: 14, name: 'Day 14 · LinkedIn break-up' },
    } as const;
  }
  return {
    day3: { step: 1, dayOffset: 3, name: 'Day 3 · Quick follow-up' },
    day7: { step: 2, dayOffset: 7, name: 'Day 7 · Value-add' },
    day14: { step: 3, dayOffset: 14, name: 'Day 14 · Break-up' },
  } as const;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as ApplyBody;
    const platform: 'email' | 'linkedin' =
      body.platform === 'linkedin' ? 'linkedin' : 'email';
    const FOLLOWUP_META = metaForPlatform(platform);
    const description =
      platform === 'linkedin'
        ? 'Active prompt used for LinkedIn message generation'
        : 'Active prompt used for email generation';
    const applied: string[] = [];

    if (typeof body.initial === 'string' && body.initial.trim()) {
      const content = body.initial.trim();
      const existing = await prisma.prompt.findFirst({
        where: { userId: user.id, name: 'active_prompt', platform },
      });
      if (existing) {
        await prisma.prompt.update({
          where: { id: existing.id },
          data: { content },
        });
      } else {
        await prisma.prompt.create({
          data: {
            userId: user.id,
            name: 'active_prompt',
            content,
            description,
            isSystem: false,
            isActive: true,
            platform,
          },
        });
      }
      applied.push('initial');
    }

    for (const key of ['day3', 'day7', 'day14'] as const) {
      const content = body[key];
      if (typeof content !== 'string' || !content.trim()) continue;
      const meta = FOLLOWUP_META[key];
      const existing = await prisma.followUpPrompt.findFirst({
        where: { userId: user.id, step: meta.step, platform },
      });
      if (existing) {
        await prisma.followUpPrompt.update({
          where: { id: existing.id },
          data: {
            content: content.trim(),
            dayOffset: meta.dayOffset,
            name: meta.name,
            isActive: true,
          },
        });
      } else {
        await prisma.followUpPrompt.create({
          data: {
            userId: user.id,
            step: meta.step,
            platform,
            dayOffset: meta.dayOffset,
            name: meta.name,
            content: content.trim(),
            isActive: true,
          },
        });
      }
      applied.push(key);
    }

    if (applied.length === 0) {
      return NextResponse.json(
        { error: 'No prompts provided to apply. Send at least one of initial / day3 / day7 / day14.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ applied });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('[ai-apply-prompts] error:', error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
