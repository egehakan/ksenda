import { NextResponse } from 'next/server';
import { getPipelineStats } from '@/lib/services/pipeline';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const stats = await getPipelineStats(user.id);
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Error fetching pipeline stats:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline stats' }, { status: 500 });
  }
}
