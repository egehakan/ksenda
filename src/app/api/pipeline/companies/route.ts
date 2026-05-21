import { NextRequest, NextResponse } from 'next/server';
import { getCompaniesByState } from '@/lib/services/pipeline';
import { PIPELINE_STATES, type PipelineState } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') as PipelineState;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const channelParam = searchParams.get('channel');
    const channel: 'email' | 'linkedin' | 'all' =
      channelParam === 'email' ? 'email' : channelParam === 'linkedin' ? 'linkedin' : 'all';

    if (!state || !Object.values(PIPELINE_STATES).includes(state)) {
      return NextResponse.json(
        { error: 'Invalid or missing state parameter' },
        { status: 400 }
      );
    }

    const result = await getCompaniesByState(user.id, state, limit, offset, channel);

    return NextResponse.json({
      companies: result.companies,
      total: result.total,
      state,
      channel,
      page: Math.floor(offset / limit) + 1,
      perPage: limit,
    });
  } catch (error) {
    console.error('Error fetching companies by state:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}
