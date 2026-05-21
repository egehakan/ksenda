import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET /api/automation/recipes — list the user's recipes (built-ins + custom).
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const recipes = await prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: [{ isBuiltIn: 'desc' }, { code: 'asc' }],
    });

    const parsed = recipes.map((r) => {
      let filters: Record<string, unknown> | null = null;
      try {
        filters = JSON.parse(r.filtersJson);
      } catch {
        filters = null;
      }
      return { ...r, filters };
    });

    return NextResponse.json({ recipes: parsed });
  } catch (error) {
    console.error('GET /api/automation/recipes error:', error);
    return NextResponse.json({ error: 'Failed to list recipes' }, { status: 500 });
  }
}

/**
 * POST /api/automation/recipes — create a custom recipe. Built-in codes
 * (A1..B5) are protected; user codes must not collide with them.
 *
 * Body: { code, name, description?, kind, filters, defaultDailyCap? }
 */
const BUILTIN_CODES = new Set(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5']);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { code, name, description, kind, filters, defaultDailyCap, aiFilter, channel } = body || {};

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Recipe code is required' }, { status: 400 });
    }
    if (BUILTIN_CODES.has(code.toUpperCase())) {
      return NextResponse.json(
        { error: `Code ${code} is reserved for a built-in recipe` },
        { status: 400 }
      );
    }
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Recipe name is required' }, { status: 400 });
    }
    if (kind !== 'companies' && kind !== 'people') {
      return NextResponse.json({ error: 'kind must be companies or people' }, { status: 400 });
    }
    if (!filters || typeof filters !== 'object') {
      return NextResponse.json({ error: 'filters object is required' }, { status: 400 });
    }

    const validAiFilter =
      aiFilter === 'no_ai' || aiFilter === 'has_ai' ? aiFilter : 'any';
    const validChannel: 'email' | 'linkedin' =
      channel === 'linkedin' ? 'linkedin' : 'email';

    const created = await prisma.savedSearch.create({
      data: {
        userId: user.id,
        code,
        name,
        description: description || null,
        kind,
        filtersJson: JSON.stringify(filters),
        defaultDailyCap: typeof defaultDailyCap === 'number' ? defaultDailyCap : 25,
        isBuiltIn: false,
        aiFilter: validAiFilter,
        channel: validChannel,
      },
    });

    return NextResponse.json({ recipe: created });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'A recipe with this code already exists.' }, { status: 409 });
    }
    console.error('POST /api/automation/recipes error:', error);
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 });
  }
}
