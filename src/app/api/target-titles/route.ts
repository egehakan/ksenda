import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET — return the user's saved Target Titles, priority-ordered.
 *
 * Brand-new users return an empty list. The onboarding flow and the
 * settings dialog both handle that state — the user picks their own
 * titles from the categorized catalog instead of having 557 defaults
 * auto-seeded (which used to take 60+ seconds via sequential Turso
 * inserts on first load).
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const titles = await prisma.targetTitle.findMany({
      where: { userId: user.id },
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json({ titles });
  } catch (error) {
    console.error('Error fetching titles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch titles', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const maxPriority = await prisma.targetTitle.aggregate({
      where: { userId: user.id },
      _max: { priority: true },
    });

    const newTitle = await prisma.targetTitle.create({
      data: {
        userId: user.id,
        title: title.trim(),
        priority: (maxPriority._max.priority || 0) + 1,
        isActive: true,
      },
    });

    return NextResponse.json({ title: newTitle }, { status: 201 });
  } catch (error) {
    console.error('Error adding title:', error);

    if (error instanceof Error && error.message.includes('Unique')) {
      return NextResponse.json({ error: 'This title already exists' }, { status: 409 });
    }

    return NextResponse.json({ error: 'Failed to add title' }, { status: 500 });
  }
}

/**
 * Bulk replace the user's full target-title list. Used by onboarding so the
 * user can pick from a categorized catalog and persist the whole selection
 * in one call (no add-one-at-a-time round-trips). Priority follows the
 * payload's array order — index 0 is highest priority.
 *
 *   PUT /api/target-titles   { titles: ["CEO", "Founder", "VP Sales", ...] }
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { titles } = body as { titles?: unknown };

    if (!Array.isArray(titles)) {
      return NextResponse.json(
        { error: 'titles must be an array of strings' },
        { status: 400 }
      );
    }

    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const t of titles) {
      if (typeof t !== 'string') continue;
      const trimmed = t.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(trimmed);
    }

    await prisma.$transaction([
      prisma.targetTitle.deleteMany({ where: { userId: user.id } }),
      ...cleaned.map((title, index) =>
        prisma.targetTitle.create({
          data: {
            userId: user.id,
            title,
            priority: index,
            isActive: true,
          },
        })
      ),
    ]);

    const saved = await prisma.targetTitle.findMany({
      where: { userId: user.id },
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json({ titles: saved });
  } catch (error) {
    console.error('Error replacing titles:', error);
    return NextResponse.json(
      { error: 'Failed to replace titles', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs are required' }, { status: 400 });
    }

    const deleteResult = await prisma.targetTitle.deleteMany({
      where: { id: { in: ids }, userId: user.id },
    });

    return NextResponse.json({ success: true, deleted: deleteResult.count });
  } catch (error) {
    console.error('Error deleting titles:', error);
    return NextResponse.json({ error: 'Failed to delete titles' }, { status: 500 });
  }
}
