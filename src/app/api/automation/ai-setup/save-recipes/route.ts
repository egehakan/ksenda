import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * POST /api/automation/ai-setup/save-recipes — bulk-creates the AI-
 * proposed recipes the user approved. Generates collision-free codes
 * (AI-1, AI-2, …) by scanning existing codes. Returns the saved rows
 * with their ids so the client can preselect them in the next wizard
 * stage (auto-fill).
 *
 * Body: { recipes: [{ name, description, kind, defaultDailyCap,
 *                     filters, aiFilter }, ...] }
 */
const BUILTIN_CODES = new Set(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5']);

interface IncomingRecipe {
  name: string;
  description?: string;
  kind: 'companies' | 'people';
  defaultDailyCap: number;
  filters: Record<string, unknown>;
  aiFilter?: 'any' | 'no_ai' | 'has_ai';
  channel?: 'email' | 'linkedin';
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const incoming: unknown = body?.recipes;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json(
        { error: 'recipes array is required' },
        { status: 400 }
      );
    }

    // Normalize + validate the payload. Reject the whole batch if any
    // item is malformed — the wizard sends already-validated proposals.
    const items: IncomingRecipe[] = [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') {
        return NextResponse.json({ error: 'Invalid recipe in batch' }, { status: 400 });
      }
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      const kind = r.kind === 'people' ? 'people' : r.kind === 'companies' ? 'companies' : null;
      const cap =
        typeof r.defaultDailyCap === 'number'
          ? Math.round(r.defaultDailyCap)
          : null;
      const filters =
        r.filters && typeof r.filters === 'object'
          ? (r.filters as Record<string, unknown>)
          : null;
      if (!name || !kind || cap === null || !filters) {
        return NextResponse.json(
          { error: `Recipe missing required fields: ${name || '(unnamed)'}` },
          { status: 400 }
        );
      }
      items.push({
        name,
        description:
          typeof r.description === 'string' ? r.description.trim() : '',
        kind,
        defaultDailyCap: Math.min(50, Math.max(1, cap)),
        filters,
        aiFilter:
          r.aiFilter === 'no_ai' || r.aiFilter === 'has_ai' || r.aiFilter === 'any'
            ? r.aiFilter
            : 'any',
        channel:
          r.channel === 'linkedin' ? 'linkedin' : 'email',
      });
    }

    // Scan existing codes once to find the next free AI-N suffix. We
    // index by AI-* prefix and pick max(N) + 1 as the starting point.
    // We also collect all codes (including built-ins) so non-AI-prefix
    // collisions are caught defensively.
    const existing = await prisma.savedSearch.findMany({
      where: { userId: user.id },
      select: { code: true },
    });
    const allCodes = new Set<string>(BUILTIN_CODES);
    let maxAi = 0;
    for (const e of existing) {
      allCodes.add(e.code);
      const m = e.code.match(/^AI-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxAi) maxAi = n;
      }
    }

    const created: { id: string; code: string; name: string }[] = [];
    for (const item of items) {
      // Advance N until we find a free code. Built-ins + existing user
      // recipes are excluded; AI-N is the only generator.
      let n = maxAi + 1;
      let code = `AI-${n}`;
      while (allCodes.has(code)) {
        n += 1;
        code = `AI-${n}`;
      }
      maxAi = n;
      allCodes.add(code);

      const row = await prisma.savedSearch.create({
        data: {
          userId: user.id,
          code,
          name: item.name,
          description: item.description || null,
          kind: item.kind,
          filtersJson: JSON.stringify(item.filters),
          defaultDailyCap: item.defaultDailyCap,
          isBuiltIn: false,
          aiFilter: item.aiFilter,
          channel: item.channel,
        },
        select: { id: true, code: true, name: true, channel: true },
      });
      created.push(row);
    }

    return NextResponse.json({ created });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('POST /api/automation/ai-setup/save-recipes error:', error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
