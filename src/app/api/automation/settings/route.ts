import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET /api/automation/settings — load the current user's automation config.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let savedSearchFilters: Record<string, unknown> | null = null;
    if (user.savedSearchFiltersJson) {
      try {
        savedSearchFilters = JSON.parse(user.savedSearchFiltersJson);
      } catch {
        savedSearchFilters = null;
      }
    }

    return NextResponse.json({
      settings: {
        autoImportEnabled: !!user.autoImportEnabled,
        autoApproveInitialDrafts: !!user.autoApproveInitialDrafts,
        autoSendApprovedEmails: !!user.autoSendApprovedEmails,
        autoGenerateFollowUps: !!user.autoGenerateFollowUps,
        autoApproveFollowUps: !!user.autoApproveFollowUps,
        dailyImportCap: user.dailyImportCap ?? 25,
        dailySendCap: user.dailySendCap ?? 25,
        automationWindowStartHour: user.automationWindowStartHour ?? 9,
        automationWindowEndHour: user.automationWindowEndHour ?? 17,
        automationTimezone: user.automationTimezone ?? 'Europe/Istanbul',
        savedSearchKind: user.savedSearchKind ?? null,
        savedSearchFilters,
        automationLastRunAt: user.automationLastRunAt,
        automationLastRunSummary: user.automationLastRunSummary,
      },
    });
  } catch (error) {
    console.error('GET /api/automation/settings error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

/**
 * PUT /api/automation/settings — update any subset of automation fields.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const data: Record<string, unknown> = {};

    const boolKeys = [
      'autoImportEnabled',
      'autoApproveInitialDrafts',
      'autoSendApprovedEmails',
      'autoGenerateFollowUps',
      'autoApproveFollowUps',
    ] as const;
    for (const k of boolKeys) {
      if (typeof body[k] === 'boolean') data[k] = body[k];
    }

    const intKeys = [
      'dailyImportCap',
      'dailySendCap',
      'automationWindowStartHour',
      'automationWindowEndHour',
    ] as const;
    for (const k of intKeys) {
      if (typeof body[k] === 'number' && Number.isFinite(body[k])) {
        data[k] = Math.floor(body[k]);
      }
    }
    if (typeof body.automationTimezone === 'string') {
      data.automationTimezone = body.automationTimezone;
    }

    if (
      body.savedSearchKind === 'companies' ||
      body.savedSearchKind === 'people' ||
      body.savedSearchKind === null
    ) {
      data.savedSearchKind = body.savedSearchKind;
    }
    if (body.savedSearchFilters !== undefined) {
      data.savedSearchFiltersJson =
        body.savedSearchFilters === null
          ? null
          : JSON.stringify(body.savedSearchFilters);
    }

    if (
      typeof data.automationWindowStartHour === 'number' &&
      typeof data.automationWindowEndHour === 'number' &&
      (data.automationWindowStartHour as number) >= (data.automationWindowEndHour as number)
    ) {
      return NextResponse.json(
        { error: 'Window start hour must be less than end hour' },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });
    return NextResponse.json({
      settings: {
        autoImportEnabled: !!updated.autoImportEnabled,
        autoApproveInitialDrafts: !!updated.autoApproveInitialDrafts,
        autoSendApprovedEmails: !!updated.autoSendApprovedEmails,
        autoGenerateFollowUps: !!updated.autoGenerateFollowUps,
        autoApproveFollowUps: !!updated.autoApproveFollowUps,
        dailyImportCap: updated.dailyImportCap,
        dailySendCap: updated.dailySendCap,
        automationWindowStartHour: updated.automationWindowStartHour,
        automationWindowEndHour: updated.automationWindowEndHour,
        automationTimezone: updated.automationTimezone,
        savedSearchKind: updated.savedSearchKind,
      },
    });
  } catch (error) {
    console.error('PUT /api/automation/settings error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
