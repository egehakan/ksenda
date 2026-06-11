import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { validateMultiLegFilters } from '@/lib/validate-multileg';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/automation/recipes/[id] — update a recipe. For built-ins,
 * only `defaultDailyCap` and `filters` are editable; `code` / `kind` /
 * `name` are locked.
 *
 * DELETE /api/automation/recipes/[id] — delete a custom recipe. Built-ins
 * cannot be deleted (use the seeded library as-is).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.savedSearch.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });

    const body = await request.json();
    const data: Record<string, unknown> = {};

    // aiFilter is allowed on both built-in and custom recipes — it's the
    // user's per-run gate decision, not part of the recipe's identity.
    if (body.aiFilter === 'any' || body.aiFilter === 'no_ai' || body.aiFilter === 'has_ai') {
      data.aiFilter = body.aiFilter;
    }

    // Validate a multi-country DAILY plan so a structurally-broken recipe can't
    // be persisted (the CLI silently drops empty-rotate legs and rejects a
    // zero-leg recipe). Non-multiLeg filters are unaffected.
    const mlErr = validateMultiLegFilters(body.filters);
    if (mlErr) return NextResponse.json({ error: mlErr }, { status: 400 });

    if (existing.isBuiltIn) {
      // Built-ins: cap + filters + aiFilter only. Channel is locked on
      // built-ins (A1..B5 stay email) to keep the seeded library stable.
      if (typeof body.defaultDailyCap === 'number') data.defaultDailyCap = body.defaultDailyCap;
      if (body.filters && typeof body.filters === 'object') {
        data.filtersJson = JSON.stringify(body.filters);
      }
    } else {
      if (typeof body.name === 'string') data.name = body.name;
      if (typeof body.description === 'string' || body.description === null) {
        data.description = body.description;
      }
      if (body.kind === 'companies' || body.kind === 'people') data.kind = body.kind;
      if (typeof body.defaultDailyCap === 'number') data.defaultDailyCap = body.defaultDailyCap;
      if (body.filters && typeof body.filters === 'object') {
        data.filtersJson = JSON.stringify(body.filters);
      }
      if (typeof body.code === 'string') data.code = body.code;
      // Channel is editable on custom recipes. Note: this only affects
      // newly-scheduled campaign days. Existing CampaignDay rows keep their
      // original channel (denormalized at insert time). The recipe builder
      // dialog surfaces this caveat in its inline hint.
      if (body.channel === 'email' || body.channel === 'linkedin') {
        data.channel = body.channel;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await prisma.savedSearch.update({ where: { id }, data });
    return NextResponse.json({ recipe: updated });
  } catch (error) {
    console.error('PATCH /api/automation/recipes/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.savedSearch.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });

    // Built-ins are allowed to be deleted — this only removes the user's
    // own copy of the recipe. They can be re-seeded by running
    // `scripts/seed-built-in-recipes.ts` if needed later.

    // Any CampaignDay rows pointing to this recipe will keep their row
    // (savedSearchId becomes null via the existing ON DELETE SET NULL
    // relation), and the orchestrator treats a null recipe as a skip day.
    await prisma.savedSearch.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/automation/recipes/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 });
  }
}
