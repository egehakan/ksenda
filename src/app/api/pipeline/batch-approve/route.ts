import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { transitionState } from '@/lib/services/pipeline';
import { PIPELINE_STATES } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { companyIds } = body as { companyIds: string[] };

    if (!companyIds || companyIds.length === 0) {
      return NextResponse.json({ error: 'No company IDs provided' }, { status: 400 });
    }

    const companies = await prisma.company.findMany({
      where: {
        id: { in: companyIds },
        userId: user.id,
        pipelineState: PIPELINE_STATES.PENDING_REVIEW,
      },
      include: { email: true },
    });

    if (companies.length === 0) {
      return NextResponse.json({
        success: true,
        approved: 0,
        failed: 0,
        errors: [],
        message: 'No companies found in pending_review state',
      });
    }

    const results = {
      approved: 0,
      failed: 0,
      errors: [] as Array<{ companyId: string; companyName: string; error: string }>,
    };

    for (const company of companies) {
      try {
        if (!company.email) {
          results.failed++;
          results.errors.push({
            companyId: company.id,
            companyName: company.name,
            error: 'No email found',
          });
          continue;
        }

        const finalSubject = company.email.editedSubject || company.email.subject;
        const finalBody = company.email.editedBody || company.email.body;

        await prisma.email.update({
          where: { id: company.email.id },
          data: { finalSubject, finalBody, approvedAt: new Date() },
        });

        const result = await transitionState(
          user.id,
          company.id,
          PIPELINE_STATES.APPROVED_TO_SEND
        );

        if (!result.success) {
          results.failed++;
          results.errors.push({
            companyId: company.id,
            companyName: company.name,
            error: result.error || 'Transition failed',
          });
          continue;
        }

        await prisma.auditLog.create({
          data: {
            userId: user.id,
            entityType: 'email',
            entityId: company.email.id,
            action: 'email_approved',
            metadata: { batchOperation: true },
          },
        });

        results.approved++;
      } catch (error) {
        console.error(`Error approving email for company ${company.id}:`, error);
        results.failed++;
        results.errors.push({
          companyId: company.id,
          companyName: company.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // After all approvals land, auto-send any of them whose user has
    // autoSendApprovedEmails on. Done in a second pass so the cap budget
    // is computed once against the new approved_to_send set.
    let autoSent = 0;
    if (results.approved > 0) {
      const { onEmailApproved } = await import('@/lib/services/automation');
      for (const c of companies) {
        const r = await onEmailApproved(user.id, c.id);
        if (r.sent) autoSent++;
      }
    }

    return NextResponse.json({ success: true, ...results, autoSent });
  } catch (error) {
    console.error('Error in batch approve:', error);
    return NextResponse.json({ error: 'Failed to batch approve emails' }, { status: 500 });
  }
}
