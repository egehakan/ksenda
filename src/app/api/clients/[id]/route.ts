import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

const VALID_STATUSES = [
  'contacted',
  'replied',
  'in_progress',
  'won',
  'lost',
  'no_reply',
  'snoozed',
];

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/clients/[id] — update a client's status, note, or contact
 * fields. Setting clientStatus to anything other than "contacted" pauses
 * the follow-up sequence (nextFollowUpAt is cleared).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const {
      clientStatus,
      clientNote,
      targetContactFirstName,
      targetContactLastName,
      targetContactEmail,
      targetContactTitle,
      name,
      website,
      domain,
    } = body || {};

    const existing = await prisma.company.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const data: any = {};
    if (clientStatus !== undefined) {
      if (!VALID_STATUSES.includes(clientStatus)) {
        return NextResponse.json({ error: 'Invalid clientStatus' }, { status: 400 });
      }
      data.clientStatus = clientStatus;
      data.clientStatusUpdatedAt = new Date();
      // Any status that isn't "contacted" stops the follow-up sequence.
      if (clientStatus !== 'contacted') {
        data.nextFollowUpAt = null;
      }
    }
    if (clientNote !== undefined) data.clientNote = clientNote;
    if (targetContactFirstName !== undefined) data.targetContactFirstName = targetContactFirstName;
    if (targetContactLastName !== undefined) data.targetContactLastName = targetContactLastName;
    if (targetContactEmail !== undefined) data.targetContactEmail = targetContactEmail;
    if (targetContactTitle !== undefined) data.targetContactTitle = targetContactTitle;
    if (name !== undefined) data.name = name;
    if (website !== undefined) data.website = website;
    if (domain !== undefined) data.domain = domain;

    const updated = await prisma.company.update({
      where: { id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: 'client',
        entityId: id,
        action: 'client_updated',
        metadata: data,
      },
    });

    return NextResponse.json({ client: updated });
  } catch (error) {
    console.error('PATCH /api/clients/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 });
  }
}

/**
 * DELETE /api/clients/[id] — delete a client (and its companies + emails).
 * Only operates on manually-added clients; Apollo-sourced clients should be
 * deleted from the Pipeline tab instead so the dedupe state (FetchedOrg)
 * stays consistent.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.company.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/clients/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 });
  }
}
