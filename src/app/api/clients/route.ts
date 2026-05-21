import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

/**
 * GET /api/clients — list all clients for the current user. A "client" here
 * is any Company with clientStatus set (i.e. an initial email has been
 * sent OR the user manually added them through the Clients UI).
 *
 * Optional query params:
 *   ?status=contacted,replied,in_progress  — filter by client status
 *   ?fuStep=1|2|3                          — clients with N follow-ups sent
 *   ?fuPending=true                        — clients with an unsent follow-up
 *                                            draft waiting for review
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const statuses = statusParam ? statusParam.split(',').map((s) => s.trim()) : null;
    const fuStepParam = url.searchParams.get('fuStep');
    const fuPending = url.searchParams.get('fuPending') === 'true';
    const channelParam = url.searchParams.get('channel');
    const channel: 'email' | 'linkedin' | 'all' =
      channelParam === 'email' ? 'email' : channelParam === 'linkedin' ? 'linkedin' : 'all';
    const perPage = Math.max(1, Math.min(200, parseInt(url.searchParams.get('perPage') || '50', 10)));
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));

    const where: any = { userId: user.id, clientStatus: { not: null } };
    if (statuses?.length) {
      where.clientStatus = { in: statuses };
    }
    if (fuStepParam) {
      const s = parseInt(fuStepParam, 10);
      if (Number.isInteger(s)) where.followUpStep = s;
    }
    if (fuPending) {
      // "Needs review" — at least one generated follow-up not yet sent.
      where.followUpEmails = { some: { sentAt: null } };
    }
    if (channel === 'email') {
      where.OR = [{ email: { is: null } }, { email: { channel: 'email' } }];
    } else if (channel === 'linkedin') {
      where.email = { ...(where.email ?? {}), channel: 'linkedin' };
    }

    const [clients, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          email: true,
          followUpEmails: {
            orderBy: { step: 'asc' },
          },
        },
        orderBy: [{ nextFollowUpAt: 'asc' }, { clientStatusUpdatedAt: 'desc' }],
        take: perPage,
        skip: (page - 1) * perPage,
      }),
      prisma.company.count({ where }),
    ]);

    // Counts by status for sidebar / filter pills.
    const allByStatus = await prisma.company.groupBy({
      by: ['clientStatus'],
      where: { userId: user.id, clientStatus: { not: null } },
      _count: { id: true },
    });
    const statusCounts: Record<string, number> = {};
    for (const row of allByStatus) {
      if (row.clientStatus) statusCounts[row.clientStatus] = row._count.id;
    }

    // Counts by how many follow-ups have actually been sent (Company
    // .followUpStep advances only on send), plus a "needs review" bucket
    // for clients with an unsent generated draft. Drives the follow-up
    // filter pills.
    const byFollowUpStep = await prisma.company.groupBy({
      by: ['followUpStep'],
      where: { userId: user.id, clientStatus: { not: null } },
      _count: { id: true },
    });
    const followUpCounts: { step1: number; step2: number; step3: number; pending: number } = {
      step1: 0,
      step2: 0,
      step3: 0,
      pending: 0,
    };
    for (const row of byFollowUpStep) {
      if (row.followUpStep === 1) followUpCounts.step1 = row._count.id;
      else if (row.followUpStep === 2) followUpCounts.step2 = row._count.id;
      else if (row.followUpStep === 3) followUpCounts.step3 = row._count.id;
    }
    followUpCounts.pending = await prisma.company.count({
      where: {
        userId: user.id,
        clientStatus: { not: null },
        followUpEmails: { some: { sentAt: null } },
      },
    });

    return NextResponse.json({
      clients,
      statusCounts,
      followUpCounts,
      total,
      page,
      perPage,
      channel,
    });
  } catch (error) {
    console.error('GET /api/clients error:', error);
    return NextResponse.json({ error: 'Failed to list clients' }, { status: 500 });
  }
}

/**
 * POST /api/clients — manually add a client without going through Apollo.
 *
 * Body: { name, domain?, website?, contactFirstName, contactLastName?,
 *         contactEmail?, contactTitle?, clientStatus?, clientNote? }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const {
      name,
      domain,
      website,
      industry,
      location,
      employeeCount,
      contactFirstName,
      contactLastName,
      contactEmail,
      contactTitle,
      clientStatus,
      clientNote,
    } = body || {};

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }
    const normalizedStatus = clientStatus || 'contacted';
    const validStatuses = [
      'contacted',
      'replied',
      'in_progress',
      'won',
      'lost',
      'no_reply',
      'snoozed',
    ];
    if (!validStatuses.includes(normalizedStatus)) {
      return NextResponse.json({ error: 'Invalid clientStatus' }, { status: 400 });
    }

    const company = await prisma.company.create({
      data: {
        userId: user.id,
        name,
        domain: domain || '',
        website: website || null,
        industry: industry || null,
        location: location || null,
        employeeCount: employeeCount ?? null,
        targetContactFirstName: contactFirstName || null,
        targetContactLastName: contactLastName || null,
        targetContactEmail: contactEmail || null,
        targetContactTitle: contactTitle || null,
        contactFoundAt: contactEmail ? new Date() : null,
        pipelineState: 'sent', // manual entries skip pipeline; treat as post-send
        clientStatus: normalizedStatus,
        clientStatusUpdatedAt: new Date(),
        clientNote: clientNote || null,
        isManual: true,
      },
    });

    return NextResponse.json({ client: company });
  } catch (error) {
    console.error('POST /api/clients error:', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }
}
