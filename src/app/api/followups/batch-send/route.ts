import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { sendApprovedFollowUp } from '@/lib/services/followup';

export const maxDuration = 300;

/**
 * POST /api/followups/batch-send — for each supplied company, approve and
 * send its oldest pending (unsent) follow-up draft in one shot. Mirrors the
 * per-item "Approve + send" path in the Clients detail rail, but batched so
 * the user can clear a review queue with one click.
 *
 * Body: { companyIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { companyIds } = (body || {}) as { companyIds?: string[] };

    if (!companyIds || companyIds.length === 0) {
      return NextResponse.json({ error: 'No company IDs provided' }, { status: 400 });
    }

    // SMTP batch-send only handles email-channel follow-ups; LinkedIn rows
    // go through /api/followups/batch-mark-sent (manual send by the user).
    const companies = await prisma.company.findMany({
      where: {
        id: { in: companyIds },
        userId: user.id,
        clientStatus: 'contacted',
      },
      include: {
        followUpEmails: {
          where: { sentAt: null, channel: 'email' },
          orderBy: { step: 'asc' },
        },
      },
    });

    const results = {
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [] as Array<{ companyId: string; companyName: string; error: string }>,
    };

    for (const company of companies) {
      const draft = company.followUpEmails[0];
      if (!draft) {
        // Selected but nothing to do — not an error, just nothing pending.
        results.skipped++;
        continue;
      }

      const recipientEmail = company.targetContactEmail;
      if (!recipientEmail) {
        results.failed++;
        results.errors.push({
          companyId: company.id,
          companyName: company.name,
          error: 'No recipient email on file',
        });
        continue;
      }

      try {
        // Approve: lock in the most authoritative copy (edited > generated).
        if (!draft.approvedAt) {
          const finalSubject = draft.editedSubject ?? draft.subject;
          const finalBody = draft.editedBody ?? draft.body;
          await prisma.followUpEmail.update({
            where: { id: draft.id },
            data: {
              finalSubject,
              finalBody,
              approvedAt: new Date(),
              approvedBy: user.email,
              reviewedAt: draft.reviewedAt ?? new Date(),
              reviewedBy: draft.reviewedBy ?? user.email,
            },
          });
        }

        const sendResult = await sendApprovedFollowUp(
          user.id,
          draft.id,
          recipientEmail,
          user.email
        );

        if (!sendResult.success) {
          results.failed++;
          results.errors.push({
            companyId: company.id,
            companyName: company.name,
            error: sendResult.error || 'Send failed',
          });
          continue;
        }

        results.sent++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          companyId: company.id,
          companyName: company.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Companies that were selected but not in `contacted` state (e.g. already
    // replied) get counted as skipped so the UI summary still adds up.
    results.skipped += companyIds.length - companies.length;

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('POST /api/followups/batch-send error:', error);
    return NextResponse.json(
      { error: 'Failed to batch-send follow-ups' },
      { status: 500 }
    );
  }
}
