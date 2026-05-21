import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * POST /api/db/clear — wipe the *current user's* data (companies, emails,
 * audit logs, fetched orgs). Prompts and target titles are preserved.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userCompanies = await prisma.company.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const companyIds = userCompanies.map((c) => c.id);

    await prisma.$transaction([
      prisma.email.deleteMany({ where: { companyId: { in: companyIds } } }),
      prisma.auditLog.deleteMany({ where: { userId: user.id } }),
      prisma.company.deleteMany({ where: { userId: user.id } }),
      prisma.fetchedOrganization.deleteMany({ where: { userId: user.id } }),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Your data has been cleared.',
    });
  } catch (error) {
    console.error('Error clearing database:', error);
    return NextResponse.json({ error: 'Failed to clear database' }, { status: 500 });
  }
}
