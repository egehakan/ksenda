import prisma from '@/lib/prisma';
import { PIPELINE_STATES, type PipelineState } from '@/lib/constants';

const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  [PIPELINE_STATES.PENDING_GENERATION]: [
    PIPELINE_STATES.EMAIL_NOT_GENERATED,
    PIPELINE_STATES.PENDING_REVIEW,
  ],
  [PIPELINE_STATES.EMAIL_NOT_GENERATED]: [
    PIPELINE_STATES.PENDING_GENERATION,
  ],
  [PIPELINE_STATES.PENDING_REVIEW]: [
    PIPELINE_STATES.APPROVED_TO_SEND,
    PIPELINE_STATES.PENDING_GENERATION,
  ],
  [PIPELINE_STATES.APPROVED_TO_SEND]: [
    PIPELINE_STATES.SENT,
    PIPELINE_STATES.PENDING_REVIEW,
  ],
  [PIPELINE_STATES.SENT]: [],
};

export function isValidTransition(from: PipelineState, to: PipelineState): boolean {
  const allowedTransitions = VALID_TRANSITIONS[from];
  return allowedTransitions?.includes(to) ?? false;
}

/**
 * Transition a company owned by `userId` to a new pipeline state. Cross-tenant
 * accesses return "Company not found".
 */
export async function transitionState(
  userId: string,
  companyId: string,
  toState: PipelineState,
  performedBy?: string,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
  });

  if (!company) return { success: false, error: 'Company not found' };

  const fromState = company.pipelineState as PipelineState;

  if (!isValidTransition(fromState, toState)) {
    return {
      success: false,
      error: `Invalid state transition from ${fromState} to ${toState}`,
    };
  }

  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { pipelineState: toState },
    }),
    prisma.auditLog.create({
      data: {
        userId,
        entityType: 'company',
        entityId: companyId,
        action: 'state_change',
        fromState,
        toState,
        metadata: metadata as object,
        performedBy,
      },
    }),
  ]);

  return { success: true };
}

export async function markEmailNotGenerated(
  userId: string,
  companyId: string,
  reason: string,
  performedBy?: string
): Promise<{ success: boolean; error?: string }> {
  const result = await transitionState(
    userId,
    companyId,
    PIPELINE_STATES.EMAIL_NOT_GENERATED,
    performedBy,
    { reason }
  );

  if (result.success) {
    await prisma.company.update({
      where: { id: companyId },
      data: { notGeneratedReason: { reason } },
    });
  }

  return result;
}

export async function getPipelineStats(userId: string): Promise<{
  total: number;
  byState: Record<PipelineState, number>;
}> {
  const counts = await prisma.company.groupBy({
    by: ['pipelineState'],
    where: { userId },
    _count: { id: true },
  });

  const byState = Object.fromEntries(
    Object.values(PIPELINE_STATES).map((state) => [state, 0])
  ) as Record<PipelineState, number>;

  let total = 0;
  for (const count of counts) {
    byState[count.pipelineState as PipelineState] = count._count.id;
    total += count._count.id;
  }

  return { total, byState };
}

export async function getCompaniesByState(
  userId: string,
  state: PipelineState,
  limit?: number,
  offset?: number,
  /** Optional channel filter: 'email' | 'linkedin' | 'all' (default 'all'). */
  channel?: 'email' | 'linkedin' | 'all'
): Promise<{
  companies: Awaited<ReturnType<typeof prisma.company.findMany>>;
  total: number;
}> {
  const where: any = { userId, pipelineState: state };
  if (channel === 'email') {
    // The initial outreach row's channel determines the company's channel.
    // For "email" filtering, include companies with no email row yet (they
    // are pending generation; channel is irrelevant) plus companies whose
    // email is the default 'email' channel.
    where.OR = [{ email: { is: null } }, { email: { channel: 'email' } }];
  } else if (channel === 'linkedin') {
    where.email = { channel: 'linkedin' };
  }

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: { email: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.company.count({ where }),
  ]);

  return { companies, total };
}

export async function getAuditLogs(
  userId: string,
  entityId?: string,
  limit: number = 50
): Promise<Awaited<ReturnType<typeof prisma.auditLog.findMany>>> {
  return prisma.auditLog.findMany({
    where: entityId ? { userId, entityId } : { userId },
    orderBy: { performedAt: 'desc' },
    take: limit,
  });
}
