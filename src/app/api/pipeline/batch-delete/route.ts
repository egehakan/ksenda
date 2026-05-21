import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { companyIds, alsoDeleteFromFetched = false } = body as {
      companyIds: string[];
      alsoDeleteFromFetched?: boolean;
    };

    if (!companyIds || companyIds.length === 0) {
      return NextResponse.json({ error: 'No company IDs provided' }, { status: 400 });
    }

    const results = {
      deleted: 0,
      failed: 0,
      errors: [] as Array<{ companyId: string; companyName: string; error: string }>,
    };

    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds }, userId: user.id },
      select: { id: true, name: true, apolloId: true },
    });

    const companyMap = new Map(
      companies.map((c) => [c.id, { name: c.name, apolloId: c.apolloId }])
    );

    for (const companyId of companyIds) {
      try {
        const companyInfo = companyMap.get(companyId);
        if (!companyInfo) {
          results.failed++;
          results.errors.push({
            companyId,
            companyName: 'Unknown',
            error: 'Company not found or not owned by user',
          });
          continue;
        }
        const apolloId = companyInfo.apolloId;

        await prisma.$transaction(async (tx) => {
          await tx.email.deleteMany({ where: { companyId } });
          await tx.auditLog.deleteMany({ where: { userId: user.id, entityId: companyId } });
          await tx.company.delete({ where: { id: companyId } });
          if (alsoDeleteFromFetched && apolloId) {
            await tx.fetchedOrganization.deleteMany({
              where: { userId: user.id, apolloId },
            });
          }
        });

        results.deleted++;
      } catch (error) {
        console.error(`Error deleting company ${companyId}:`, error);
        results.failed++;
        results.errors.push({
          companyId,
          companyName: companyMap.get(companyId)?.name || 'Unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('Error in batch delete:', error);
    return NextResponse.json({ error: 'Failed to batch delete companies' }, { status: 500 });
  }
}
