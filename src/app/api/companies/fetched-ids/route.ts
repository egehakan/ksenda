import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', ids: [] }, { status: 401 });

    const fetchedOrgs = await prisma.fetchedOrganization.findMany({
      where: { userId: user.id },
      select: { apolloId: true },
    });

    return NextResponse.json({ ids: fetchedOrgs.map((o) => o.apolloId) });
  } catch (error) {
    console.error('Error fetching organization IDs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization IDs', ids: [] },
      { status: 500 }
    );
  }
}
