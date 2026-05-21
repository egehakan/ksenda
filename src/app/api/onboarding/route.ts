/**
 * Onboarding state endpoint.
 *
 *   GET  /api/onboarding   — returns where the user is in the flow plus
 *                            which slices are already filled (so the page
 *                            can render the correct step on resume and
 *                            light up the green checkmarks).
 *
 *   POST /api/onboarding   — { step?, complete? } updates the last
 *                            completed step and/or marks the whole flow
 *                            done. Step writes go through the existing
 *                            /api/users/me and /api/target-titles routes;
 *                            this route only persists the marker.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export const ONBOARDING_STEPS = [
  'profile',
  'apiKeys',
  'emailProvider',
  'sender',
  'signature',
  'targetTitles',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | 'done';

const VALID_STEPS = new Set<string>([...ONBOARDING_STEPS, 'done']);

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const titleCount = await prisma.targetTitle.count({
      where: { userId: user.id, isActive: true },
    });

    // Slice "filled" heuristics. Used by the onboarding UI to:
    //   1. Decide which step to land the user on if they refresh mid-flow
    //   2. Render green checkmarks next to completed steps
    // None of these gate the dashboard on their own — `onboardingCompletedAt`
    // is the only gate. The user can leave optional slices empty and still
    // finish.
    const filled = {
      profile: !!(user.name && user.companyName && user.companyWebsite),
      apiKeys: !!(user.apolloApiKey && user.geminiApiKey),
      emailProvider: !!(user.smtpProvider && user.smtpUser && user.smtpPassword),
      sender: !!(user.senderEmail || user.senderName),
      signature: !!user.signature,
      targetTitles: titleCount > 0,
    };

    return NextResponse.json({
      step: user.onboardingStep ?? null,
      completedAt: user.onboardingCompletedAt,
      filled,
      titleCount,
      profile: {
        name: user.name,
        companyName: user.companyName,
        companyWebsite: user.companyWebsite,
      },
      emailProvider: {
        smtpProvider: user.smtpProvider,
        smtpHost: user.smtpHost,
        smtpPort: user.smtpPort,
        smtpSecure: user.smtpSecure,
        smtpUser: user.smtpUser,
      },
      sender: {
        senderEmail: user.senderEmail,
        senderName: user.senderName,
      },
      signature: user.signature,
      hasApolloKey: !!user.apolloApiKey,
      hasGeminiKey: !!user.geminiApiKey,
      hasSmtpPassword: !!user.smtpPassword,
    });
  } catch (error) {
    console.error('Onboarding state error:', error);
    return NextResponse.json(
      { error: 'Failed to load onboarding state' },
      { status: 500 }
    );
  }
}

interface PostBody {
  step?: string;
  complete?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;

    const data: Record<string, unknown> = {};

    if (body.step !== undefined) {
      if (typeof body.step !== 'string' || !VALID_STEPS.has(body.step)) {
        return NextResponse.json(
          {
            error: `Invalid step. Must be one of: ${[...VALID_STEPS].join(', ')}`,
          },
          { status: 400 }
        );
      }
      data.onboardingStep = body.step;
    }

    if (body.complete === true) {
      data.onboardingStep = 'done';
      data.onboardingCompletedAt =
        user.onboardingCompletedAt ?? new Date();
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update — pass step and/or complete=true' },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return NextResponse.json({
      step: updated.onboardingStep,
      completedAt: updated.onboardingCompletedAt,
    });
  } catch (error) {
    console.error('Onboarding update error:', error);
    return NextResponse.json(
      { error: 'Failed to update onboarding state' },
      { status: 500 }
    );
  }
}
