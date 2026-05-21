import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { reapStuckJobs } from '@/lib/services/jobs';

export const maxDuration = 300;

/**
 * GET /api/jobs/active — running jobs for the current user, plus jobs that
 * completed within the last 5 seconds (so the UI can show a brief "done"
 * flash before they vanish). Sweeps abandoned stuck jobs on every call.
 *
 * Each job includes its most-recent per-item detail rows so the expanded
 * widget card can show what's being checked / generated / sent.
 */
const DETAILS_PER_JOB = 60;

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Sweep stuck jobs first so the UI doesn't show ghosts.
    await reapStuckJobs(user.id);

    const fiveSecondsAgo = new Date(Date.now() - 5_000);
    const jobs = await prisma.generationJob.findMany({
      where: {
        userId: user.id,
        OR: [
          { status: 'running' },
          { completedAt: { gte: fiveSecondsAgo } },
        ],
      },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: {
        details: {
          orderBy: { createdAt: 'desc' },
          take: DETAILS_PER_JOB,
        },
      },
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('GET /api/jobs/active error:', error);
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 });
  }
}
