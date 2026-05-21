import "server-only";
import prisma from "@/lib/prisma";
import { fillMissingDays, last30d, last7d, type RangeKey } from "./date-ranges";

const toNumber = (v: bigint | number | null | undefined): number => {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
};

/**
 * Server-only metric query helpers for the admin dashboard. Every function
 * returns plain JSON-safe shapes so it can be called from either a server
 * component or wrapped in a thin API route.
 *
 * Convention:
 *  - User-count queries filter `role: "USER"` so the admin row never inflates
 *    tenant metrics.
 *  - Company / Email / Job queries are not filtered by role — the admin's
 *    User row is not expected to own any tenant data. If that ever changes,
 *    add a `user: { role: "USER" }` join filter.
 */

export interface OverviewKpis {
  totalUsers: number;
  verifiedUsers: number;
  totalCompanies: number;
  emailsSentAllTime: number;
  clientsWon: number;
  activeJobs: number;
}

export async function getOverviewKpis(): Promise<OverviewKpis> {
  const [
    totalUsers,
    verifiedUsers,
    totalCompanies,
    emailsSent,
    followUpsSent,
    clientsWon,
    activeJobs,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({
      where: { role: "USER", emailVerifiedAt: { not: null } },
    }),
    prisma.company.count(),
    prisma.email.count({ where: { sentAt: { not: null } } }),
    prisma.followUpEmail.count({ where: { sentAt: { not: null } } }),
    prisma.company.count({ where: { clientStatus: "won" } }),
    prisma.generationJob.count({ where: { status: "running" } }),
  ]);

  return {
    totalUsers,
    verifiedUsers,
    totalCompanies,
    emailsSentAllTime: emailsSent + followUpsSent,
    clientsWon,
    activeJobs,
  };
}

export interface SentPerDayRow {
  d: string;
  initial: number;
  followup: number;
}

/**
 * Combined initial + follow-up email send volume per day for the chosen
 * range. Returns rows ordered ASC with missing days backfilled to zero so
 * the line chart has no gaps.
 */
export async function getEmailsSentByDay(
  range: RangeKey = "30d"
): Promise<SentPerDayRow[]> {
  const since = range === "7d" ? last7d() : last30d();

  const [initialRows, followUpRows] = await Promise.all([
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', sentAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE sentAt IS NOT NULL AND sentAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', sentAt) AS d, COUNT(*) AS c
      FROM FollowUpEmail
      WHERE sentAt IS NOT NULL AND sentAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
  ]);

  const initialMap = new Map(initialRows.map((r) => [r.d, Number(r.c)]));
  const followUpMap = new Map(followUpRows.map((r) => [r.d, Number(r.c)]));
  const dates = new Set<string>([...initialMap.keys(), ...followUpMap.keys()]);

  const merged: SentPerDayRow[] = Array.from(dates)
    .sort()
    .map((d) => ({
      d,
      initial: initialMap.get(d) ?? 0,
      followup: followUpMap.get(d) ?? 0,
    }));

  return fillMissingDays(merged, range, { initial: 0, followup: 0 });
}

export interface PipelineBreakdownRow {
  state: string;
  count: number;
}

export async function getPipelineBreakdown(): Promise<PipelineBreakdownRow[]> {
  const rows = await prisma.company.groupBy({
    by: ["pipelineState"],
    _count: { id: true },
  });
  return rows.map((r) => ({ state: r.pipelineState, count: r._count.id }));
}

export interface ActivityRow {
  id: string;
  performedAt: string;
  performedBy: string | null;
  entityType: string;
  entityId: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  userEmail: string | null;
}

/**
 * Recent activity across all tenants. Bounded to 50 rows — that's all the
 * overview feed shows. Each row includes the tenant's email so the operator
 * sees *whose* data the action affected.
 */
export async function getRecentActivity(limit = 50): Promise<ActivityRow[]> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { performedAt: "desc" },
    take: limit,
    include: {
      user: { select: { email: true } },
    },
  });
  return logs.map((l) => ({
    id: l.id,
    performedAt: l.performedAt.toISOString(),
    performedBy: l.performedBy,
    entityType: l.entityType,
    entityId: l.entityId,
    action: l.action,
    fromState: l.fromState,
    toState: l.toState,
    userEmail: l.user?.email ?? null,
  }));
}

// ─── Users ────────────────────────────────────────────────────────────────

export interface UserKpis {
  signupsLast7d: number;
  signupsLast30d: number;
  totalUsers: number;
  onboardingCompleted: number;
  apolloAdopted: number;
  geminiAdopted: number;
  smtpAdopted: number;
}

export async function getUserKpis(): Promise<UserKpis> {
  const [
    signupsLast7d,
    signupsLast30d,
    totalUsers,
    onboardingCompleted,
    apolloAdopted,
    geminiAdopted,
    smtpAdopted,
  ] = await Promise.all([
    prisma.user.count({
      where: { role: "USER", createdAt: { gte: last7d() } },
    }),
    prisma.user.count({
      where: { role: "USER", createdAt: { gte: last30d() } },
    }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({
      where: { role: "USER", onboardingCompletedAt: { not: null } },
    }),
    prisma.user.count({
      where: { role: "USER", apolloApiKey: { not: null } },
    }),
    prisma.user.count({
      where: { role: "USER", geminiApiKey: { not: null } },
    }),
    prisma.user.count({ where: { role: "USER", smtpUser: { not: null } } }),
  ]);
  return {
    signupsLast7d,
    signupsLast30d,
    totalUsers,
    onboardingCompleted,
    apolloAdopted,
    geminiAdopted,
    smtpAdopted,
  };
}

export interface OnboardingFunnelRow {
  step: string;
  count: number;
}

export async function getOnboardingFunnel(): Promise<OnboardingFunnelRow[]> {
  const rows = await prisma.user.groupBy({
    by: ["onboardingStep"],
    where: { role: "USER" },
    _count: { id: true },
  });
  return rows.map((r) => ({
    step: r.onboardingStep || "not_started",
    count: r._count.id,
  }));
}

export interface AutomationAdoption {
  autoImport: number;
  autoApproveInitial: number;
  autoSend: number;
  autoFollowUp: number;
  autoApproveFollowUp: number;
}

export async function getAutomationAdoption(): Promise<AutomationAdoption> {
  const [a, b, c, d, e] = await Promise.all([
    prisma.user.count({ where: { role: "USER", autoImportEnabled: true } }),
    prisma.user.count({
      where: { role: "USER", autoApproveInitialDrafts: true },
    }),
    prisma.user.count({
      where: { role: "USER", autoSendApprovedEmails: true },
    }),
    prisma.user.count({
      where: { role: "USER", autoGenerateFollowUps: true },
    }),
    prisma.user.count({ where: { role: "USER", autoApproveFollowUps: true } }),
  ]);
  return {
    autoImport: a,
    autoApproveInitial: b,
    autoSend: c,
    autoFollowUp: d,
    autoApproveFollowUp: e,
  };
}

export interface UserListRow {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingStep: string | null;
  hasApollo: boolean;
  hasGemini: boolean;
  hasSmtp: boolean;
  automationFlags: {
    autoImport: boolean;
    autoApproveInitial: boolean;
    autoSend: boolean;
    autoFollowUp: boolean;
    autoApproveFollowUp: boolean;
  };
  companiesCount: number;
  emailsSentCount: number;
  lastActivityAt: string | null;
}

export async function getUserListWithStats(): Promise<UserListRow[]> {
  const users = await prisma.user.findMany({
    where: { role: "USER" },
    orderBy: { createdAt: "desc" },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return [];

  const [companyCounts, emailSentByUser, followUpSentByUser, lastActivity] =
    await Promise.all([
      prisma.company.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _count: { id: true },
      }),
      prisma.$queryRaw<Array<{ userId: string; c: bigint | number }>>`
        SELECT c.userId AS userId, COUNT(*) AS c
        FROM Email e
        INNER JOIN Company c ON c.id = e.companyId
        WHERE e.sentAt IS NOT NULL
        GROUP BY c.userId
      `,
      prisma.$queryRaw<Array<{ userId: string; c: bigint | number }>>`
        SELECT c.userId AS userId, COUNT(*) AS c
        FROM FollowUpEmail f
        INNER JOIN Company c ON c.id = f.companyId
        WHERE f.sentAt IS NOT NULL
        GROUP BY c.userId
      `,
      prisma.auditLog.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _max: { performedAt: true },
      }),
    ]);

  const companyMap = new Map(companyCounts.map((r) => [r.userId, r._count.id]));
  const emailMap = new Map(
    emailSentByUser.map((r) => [r.userId, toNumber(r.c)])
  );
  const followUpMap = new Map(
    followUpSentByUser.map((r) => [r.userId, toNumber(r.c)])
  );
  const activityMap = new Map(
    lastActivity.map((r) => [
      r.userId,
      r._max.performedAt ? r._max.performedAt.toISOString() : null,
    ])
  );

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    companyName: u.companyName,
    createdAt: u.createdAt.toISOString(),
    emailVerifiedAt: u.emailVerifiedAt
      ? u.emailVerifiedAt.toISOString()
      : null,
    onboardingCompletedAt: u.onboardingCompletedAt
      ? u.onboardingCompletedAt.toISOString()
      : null,
    onboardingStep: u.onboardingStep,
    hasApollo: !!u.apolloApiKey,
    hasGemini: !!u.geminiApiKey,
    hasSmtp: !!u.smtpUser,
    automationFlags: {
      autoImport: u.autoImportEnabled,
      autoApproveInitial: u.autoApproveInitialDrafts,
      autoSend: u.autoSendApprovedEmails,
      autoFollowUp: u.autoGenerateFollowUps,
      autoApproveFollowUp: u.autoApproveFollowUps,
    },
    companiesCount: companyMap.get(u.id) ?? 0,
    emailsSentCount:
      (emailMap.get(u.id) ?? 0) + (followUpMap.get(u.id) ?? 0),
    lastActivityAt: activityMap.get(u.id) ?? null,
  }));
}

export interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  createdAt: string;
  updatedAt: string;
  emailVerifiedAt: string | null;
  onboardingStep: string | null;
  onboardingCompletedAt: string | null;
  hasApollo: boolean;
  hasGemini: boolean;
  smtp: {
    provider: string | null;
    user: string | null;
    senderEmail: string | null;
    senderName: string | null;
    verified: boolean;
  };
  automationFlags: {
    autoImport: boolean;
    autoApproveInitial: boolean;
    autoSend: boolean;
    autoFollowUp: boolean;
    autoApproveFollowUp: boolean;
  };
  dailyImportCap: number;
  dailySendCap: number;
  automationLastRunAt: string | null;
  stats: {
    totalCompanies: number;
    pipelineBreakdown: PipelineBreakdownRow[];
    emailsGenerated: number;
    emailsSent: number;
    followUpsSent: number;
    clientsWon: number;
    clientsByStatus: Array<{ status: string; count: number }>;
    activeJobs: number;
  };
  recentActivity: ActivityRow[];
}

export async function getUserDetail(
  userId: string
): Promise<UserDetail | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "USER") return null;

  const [
    totalCompanies,
    pipelineRows,
    emailsGenerated,
    emailsSent,
    followUpsSent,
    clientsWon,
    clientsByStatus,
    activeJobs,
    recentLogs,
  ] = await Promise.all([
    prisma.company.count({ where: { userId } }),
    prisma.company.groupBy({
      by: ["pipelineState"],
      where: { userId },
      _count: { id: true },
    }),
    prisma.email.count({ where: { company: { userId } } }),
    prisma.email.count({
      where: { company: { userId }, sentAt: { not: null } },
    }),
    prisma.followUpEmail.count({
      where: { company: { userId }, sentAt: { not: null } },
    }),
    prisma.company.count({ where: { userId, clientStatus: "won" } }),
    prisma.company.groupBy({
      by: ["clientStatus"],
      where: { userId, clientStatus: { not: null } },
      _count: { id: true },
    }),
    prisma.generationJob.count({
      where: { userId, status: "running" },
    }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { performedAt: "desc" },
      take: 30,
      include: { user: { select: { email: true } } },
    }),
  ]);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    companyName: user.companyName,
    companyWebsite: user.companyWebsite,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    emailVerifiedAt: user.emailVerifiedAt
      ? user.emailVerifiedAt.toISOString()
      : null,
    onboardingStep: user.onboardingStep,
    onboardingCompletedAt: user.onboardingCompletedAt
      ? user.onboardingCompletedAt.toISOString()
      : null,
    hasApollo: !!user.apolloApiKey,
    hasGemini: !!user.geminiApiKey,
    smtp: {
      provider: user.smtpProvider,
      user: user.smtpUser,
      senderEmail: user.senderEmail,
      senderName: user.senderName,
      verified: !!user.smtpUser && !!user.smtpPassword,
    },
    automationFlags: {
      autoImport: user.autoImportEnabled,
      autoApproveInitial: user.autoApproveInitialDrafts,
      autoSend: user.autoSendApprovedEmails,
      autoFollowUp: user.autoGenerateFollowUps,
      autoApproveFollowUp: user.autoApproveFollowUps,
    },
    dailyImportCap: user.dailyImportCap,
    dailySendCap: user.dailySendCap,
    automationLastRunAt: user.automationLastRunAt
      ? user.automationLastRunAt.toISOString()
      : null,
    stats: {
      totalCompanies,
      pipelineBreakdown: pipelineRows.map((r) => ({
        state: r.pipelineState,
        count: r._count.id,
      })),
      emailsGenerated,
      emailsSent,
      followUpsSent,
      clientsWon,
      clientsByStatus: clientsByStatus.map((r) => ({
        status: r.clientStatus ?? "unknown",
        count: r._count.id,
      })),
      activeJobs,
    },
    recentActivity: recentLogs.map((l) => ({
      id: l.id,
      performedAt: l.performedAt.toISOString(),
      performedBy: l.performedBy,
      entityType: l.entityType,
      entityId: l.entityId,
      action: l.action,
      fromState: l.fromState,
      toState: l.toState,
      userEmail: l.user?.email ?? null,
    })),
  };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

export interface PipelineKpis {
  companiesTotal: number;
  companiesLast7d: number;
  emailsGenerated: number;
  emailsGeneratedLast7d: number;
  emailsSent: number;
  emailsSentLast7d: number;
  approvalRatePct: number;
  sendSuccessRatePct: number;
  avgSendAttempts: number;
  followUpsSent: number;
}

export async function getPipelineKpis(): Promise<PipelineKpis> {
  const since7d = last7d();
  const since30d = last30d();

  const [
    companiesTotal,
    companiesLast7d,
    emailsGenerated,
    emailsGeneratedLast7d,
    emailsSent,
    emailsSentLast7d,
    approvalCounts,
    sendCounts,
    sendAttemptsAgg,
    followUpsSent,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { createdAt: { gte: since7d } } }),
    prisma.email.count(),
    prisma.email.count({ where: { generatedAt: { gte: since7d } } }),
    prisma.email.count({ where: { sentAt: { not: null } } }),
    prisma.email.count({
      where: { sentAt: { not: null, gte: since7d } },
    }),
    // Approval rate (last 30d): approved / generated (after review).
    Promise.all([
      prisma.email.count({
        where: { approvedAt: { not: null, gte: since30d } },
      }),
      prisma.email.count({ where: { generatedAt: { gte: since30d } } }),
    ]),
    // Send success rate: sent / approved.
    Promise.all([
      prisma.email.count({ where: { sentAt: { not: null } } }),
      prisma.email.count({ where: { approvedAt: { not: null } } }),
    ]),
    prisma.email.aggregate({
      _avg: { sendAttempts: true },
      where: { sentAt: { not: null } },
    }),
    prisma.followUpEmail.count({ where: { sentAt: { not: null } } }),
  ]);

  const [approvedCount, generatedDenom] = approvalCounts;
  const [sentCount, approvedDenom] = sendCounts;

  return {
    companiesTotal,
    companiesLast7d,
    emailsGenerated,
    emailsGeneratedLast7d,
    emailsSent,
    emailsSentLast7d,
    approvalRatePct: rate(approvedCount, generatedDenom),
    sendSuccessRatePct: rate(sentCount, approvedDenom),
    avgSendAttempts:
      Math.round((sendAttemptsAgg._avg.sendAttempts ?? 0) * 10) / 10,
    followUpsSent,
  };
}

export interface PipelineSeriesRow {
  d: string;
  generated: number;
  approved: number;
  sent: number;
}

export async function getPipelineTimeseries(
  range: RangeKey = "30d"
): Promise<PipelineSeriesRow[]> {
  const since = range === "7d" ? last7d() : last30d();
  const [genRows, apprRows, sentRows] = await Promise.all([
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', generatedAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE generatedAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', approvedAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE approvedAt IS NOT NULL AND approvedAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', sentAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE sentAt IS NOT NULL AND sentAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
  ]);

  const map = (
    rows: Array<{ d: string; c: bigint | number }>
  ): Map<string, number> =>
    new Map(rows.map((r) => [r.d, toNumber(r.c)]));

  const g = map(genRows);
  const a = map(apprRows);
  const s = map(sentRows);
  const dates = new Set<string>([...g.keys(), ...a.keys(), ...s.keys()]);

  const merged: PipelineSeriesRow[] = Array.from(dates)
    .sort()
    .map((d) => ({
      d,
      generated: g.get(d) ?? 0,
      approved: a.get(d) ?? 0,
      sent: s.get(d) ?? 0,
    }));

  return fillMissingDays(merged, range, { generated: 0, approved: 0, sent: 0 });
}

export interface FollowUpStepRow {
  step: number;
  count: number;
}

export async function getFollowUpStepDistribution(): Promise<FollowUpStepRow[]> {
  const rows = await prisma.company.groupBy({
    by: ["followUpStep"],
    _count: { id: true },
  });
  return rows.map((r) => ({ step: r.followUpStep, count: r._count.id }));
}

// ─── Outcomes ─────────────────────────────────────────────────────────────

export interface OutcomesKpis {
  totalClients: number;
  replied: number;
  won: number;
  lost: number;
  noReply: number;
  inProgress: number;
  pendingFollowUp: number;
  replyRatePct: number;
  winRatePct: number;
}

export async function getOutcomesKpis(): Promise<OutcomesKpis> {
  const REPLY_STATES = ["replied", "in_progress", "won", "lost"];

  const [statuses, pendingFollowUp] = await Promise.all([
    prisma.company.groupBy({
      by: ["clientStatus"],
      where: { clientStatus: { not: null } },
      _count: { id: true },
    }),
    prisma.company.count({
      where: { nextFollowUpAt: { not: null, lte: new Date() } },
    }),
  ]);

  let total = 0;
  let replied = 0;
  let won = 0;
  let lost = 0;
  let noReply = 0;
  let inProgress = 0;

  for (const row of statuses) {
    const c = row._count.id;
    total += c;
    if (row.clientStatus === "replied") replied += c;
    if (row.clientStatus === "in_progress") inProgress += c;
    if (row.clientStatus === "won") won += c;
    if (row.clientStatus === "lost") lost += c;
    if (row.clientStatus === "no_reply") noReply += c;
  }

  const repliedAny = statuses
    .filter((s) => REPLY_STATES.includes(s.clientStatus ?? ""))
    .reduce((sum, s) => sum + s._count.id, 0);

  return {
    totalClients: total,
    replied,
    won,
    lost,
    noReply,
    inProgress,
    pendingFollowUp,
    replyRatePct: rate(repliedAny, total),
    winRatePct: rate(won, total),
  };
}

export interface ClientStatusRow {
  status: string;
  count: number;
}

export async function getClientStatusBreakdown(): Promise<ClientStatusRow[]> {
  const rows = await prisma.company.groupBy({
    by: ["clientStatus"],
    where: { clientStatus: { not: null } },
    _count: { id: true },
  });
  return rows.map((r) => ({
    status: r.clientStatus ?? "unknown",
    count: r._count.id,
  }));
}

export interface TopUserRow {
  userId: string;
  email: string;
  won: number;
}

export async function getTopUsersByWonClients(
  limit = 8
): Promise<TopUserRow[]> {
  const grouped = await prisma.company.groupBy({
    by: ["userId"],
    where: { clientStatus: "won" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return [];
  const userIds = grouped.map((g) => g.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  return grouped.map((g) => ({
    userId: g.userId,
    email: emailById.get(g.userId) ?? g.userId,
    won: g._count.id,
  }));
}

export interface OverdueFollowUp {
  companyId: string;
  companyName: string;
  domain: string;
  nextFollowUpAt: string;
  followUpStep: number;
  userEmail: string;
}

export async function getOverdueFollowUps(
  limit = 50
): Promise<OverdueFollowUp[]> {
  const rows = await prisma.company.findMany({
    where: { nextFollowUpAt: { not: null, lte: new Date() } },
    orderBy: { nextFollowUpAt: "asc" },
    take: limit,
    include: { user: { select: { email: true } } },
  });
  return rows.map((r) => ({
    companyId: r.id,
    companyName: r.name,
    domain: r.domain,
    nextFollowUpAt: r.nextFollowUpAt!.toISOString(),
    followUpStep: r.followUpStep,
    userEmail: r.user.email,
  }));
}

function rate(num: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 100);
}

// ─── Automation ───────────────────────────────────────────────────────────

export interface AutomationKpis {
  autoSendEnabled: number;
  scheduledNext7d: number;
  capUtilizationPct: number;
  runSuccessRatePct: number;
  totalRunsLast30d: number;
}

export async function getAutomationKpis(): Promise<AutomationKpis> {
  const since30d = last30d();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayKey = todayStart.toISOString().slice(0, 10);
  const sevenDaysOut = new Date(Date.now() + 7 * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    autoSendEnabled,
    scheduledNext7d,
    sumDailyCap,
    sentToday,
    runs,
  ] = await Promise.all([
    prisma.user.count({
      where: { role: "USER", autoSendApprovedEmails: true },
    }),
    prisma.campaignDay.count({
      where: {
        status: "scheduled",
        scheduledDate: { gte: todayKey, lte: sevenDaysOut },
      },
    }),
    prisma.user.aggregate({
      where: { role: "USER", autoSendApprovedEmails: true },
      _sum: { dailySendCap: true },
    }),
    prisma.email.count({
      where: { sentAt: { gte: todayStart } },
    }),
    prisma.generationJob.findMany({
      where: { kind: "automation_run", startedAt: { gte: since30d } },
      select: { status: true },
    }),
  ]);

  const completed = runs.filter((r) => r.status === "completed").length;
  const total = runs.length;
  const capTotal = sumDailyCap._sum.dailySendCap ?? 0;

  return {
    autoSendEnabled,
    scheduledNext7d,
    capUtilizationPct: rate(sentToday, capTotal),
    runSuccessRatePct: rate(completed, total),
    totalRunsLast30d: total,
  };
}

export interface RecipeUsageRow {
  code: string;
  name: string;
  usage: number;
}

export async function getRecipeUsage(limit = 10): Promise<RecipeUsageRow[]> {
  const grouped = await prisma.campaignDay.groupBy({
    by: ["savedSearchId"],
    where: { savedSearchId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return [];
  const ids = grouped
    .map((g) => g.savedSearchId)
    .filter((id): id is string => !!id);
  const searches = await prisma.savedSearch.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(searches.map((s) => [s.id, s]));
  return grouped
    .filter((g) => g.savedSearchId && byId.has(g.savedSearchId))
    .map((g) => {
      const s = byId.get(g.savedSearchId!)!;
      return { code: s.code, name: s.name, usage: g._count.id };
    });
}

export interface AutomationRunRow {
  d: string;
  completed: number;
  failed: number;
}

export async function getAutomationRunsTimeseries(
  range: RangeKey = "30d"
): Promise<AutomationRunRow[]> {
  const since = range === "7d" ? last7d() : last30d();
  const [completed, failed] = await Promise.all([
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', startedAt) AS d, COUNT(*) AS c
      FROM GenerationJob
      WHERE kind = 'automation_run' AND status = 'completed' AND startedAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', startedAt) AS d, COUNT(*) AS c
      FROM GenerationJob
      WHERE kind = 'automation_run' AND status = 'failed' AND startedAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
  ]);

  const cMap = new Map(completed.map((r) => [r.d, toNumber(r.c)]));
  const fMap = new Map(failed.map((r) => [r.d, toNumber(r.c)]));
  const dates = new Set<string>([...cMap.keys(), ...fMap.keys()]);
  const merged: AutomationRunRow[] = Array.from(dates)
    .sort()
    .map((d) => ({
      d,
      completed: cMap.get(d) ?? 0,
      failed: fMap.get(d) ?? 0,
    }));
  return fillMissingDays(merged, range, { completed: 0, failed: 0 });
}

export interface CampaignDayRow {
  id: string;
  scheduledDate: string;
  status: string;
  userEmail: string;
  recipeName: string | null;
  dailySendCap: number;
  outcomeSummary: string | null;
  ranAt: string | null;
}

export async function getTodaysCampaignDays(): Promise<CampaignDayRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await prisma.campaignDay.findMany({
    where: { scheduledDate: today },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { email: true } },
      savedSearch: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    scheduledDate: r.scheduledDate,
    status: r.status,
    userEmail: r.user.email,
    recipeName: r.savedSearch?.name ?? null,
    dailySendCap: r.dailySendCap,
    outcomeSummary: r.outcomeSummary,
    ranAt: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

// ─── Audit ────────────────────────────────────────────────────────────────

export interface AuditLogsPagedArgs {
  entityType?: string;
  action?: string;
  userEmail?: string;
  performedBy?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface AuditLogsPagedResult {
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Distinct entityType values for the filter dropdown. */
  entityTypes: string[];
  /** Distinct action values for the filter dropdown. */
  actions: string[];
}

export async function getAuditLogsPaged(
  args: AuditLogsPagedArgs = {}
): Promise<AuditLogsPagedResult> {
  const pageSize = Math.min(Math.max(args.pageSize ?? 50, 10), 200);
  const page = Math.max(args.page ?? 1, 1);

  // Resolve userEmail -> userId for filtering. If a partial email was given,
  // match by exact email; if it doesn't resolve, the result set is empty.
  let userId: string | undefined;
  if (args.userEmail) {
    const u = await prisma.user.findUnique({
      where: { email: args.userEmail.trim().toLowerCase() },
      select: { id: true },
    });
    if (!u) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        pageCount: 0,
        entityTypes: await distinctAuditField("entityType"),
        actions: await distinctAuditField("action"),
      };
    }
    userId = u.id;
  }

  const where: NonNullable<
    Parameters<typeof prisma.auditLog.findMany>[0]
  >["where"] = {
    ...(args.entityType ? { entityType: args.entityType } : {}),
    ...(args.action ? { action: args.action } : {}),
    ...(userId ? { userId } : {}),
    ...(args.performedBy
      ? { performedBy: { contains: args.performedBy } }
      : {}),
    ...(args.from || args.to
      ? {
          performedAt: {
            ...(args.from ? { gte: args.from } : {}),
            ...(args.to ? { lte: args.to } : {}),
          },
        }
      : {}),
  };

  const [total, logs, entityTypes, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { performedAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: { user: { select: { email: true } } },
    }),
    distinctAuditField("entityType"),
    distinctAuditField("action"),
  ]);

  return {
    rows: logs.map((l) => ({
      id: l.id,
      performedAt: l.performedAt.toISOString(),
      performedBy: l.performedBy,
      entityType: l.entityType,
      entityId: l.entityId,
      action: l.action,
      fromState: l.fromState,
      toState: l.toState,
      userEmail: l.user?.email ?? null,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    entityTypes,
    actions,
  };
}

async function distinctAuditField(field: "entityType" | "action"): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: [field],
    select: { [field]: true } as Record<typeof field, true>,
    orderBy: { [field]: "asc" } as Record<typeof field, "asc">,
    take: 100,
  });
  return rows
    .map((r) => (r as unknown as Record<string, string>)[field])
    .filter((v): v is string => !!v);
}

// ─── System ───────────────────────────────────────────────────────────────

export interface SystemKpis {
  jobsRunning: number;
  jobsFailed24h: number;
  emailSendErrorRatePct: number;
  longestRunningMinutes: number;
  stuckJobs: number;
  totalJobsLast30d: number;
}

export async function getSystemKpis(): Promise<SystemKpis> {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const since30d = last30d();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [
    jobsRunning,
    jobsFailed24h,
    sendErrors7d,
    sendsLast7d,
    longestRunning,
    stuckJobs,
    totalJobsLast30d,
  ] = await Promise.all([
    prisma.generationJob.count({ where: { status: "running" } }),
    prisma.generationJob.count({
      where: { status: "failed", completedAt: { gte: since24h } },
    }),
    prisma.email.count({
      where: { sendError: { not: null }, updatedAt: { gte: last7d() } },
    }),
    prisma.email.count({
      where: {
        OR: [
          { sentAt: { not: null, gte: last7d() } },
          { sendError: { not: null }, updatedAt: { gte: last7d() } },
        ],
      },
    }),
    prisma.generationJob.findFirst({
      where: { status: "running" },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    }),
    prisma.generationJob.count({
      where: {
        status: "running",
        OR: [
          { lastHeartbeatAt: null },
          { lastHeartbeatAt: { lt: fiveMinAgo } },
        ],
      },
    }),
    prisma.generationJob.count({
      where: { startedAt: { gte: since30d } },
    }),
  ]);

  const longestMinutes = longestRunning
    ? Math.floor((Date.now() - longestRunning.startedAt.getTime()) / 60000)
    : 0;

  return {
    jobsRunning,
    jobsFailed24h,
    emailSendErrorRatePct: rate(sendErrors7d, sendsLast7d),
    longestRunningMinutes: longestMinutes,
    stuckJobs,
    totalJobsLast30d,
  };
}

export interface JobStatusRow {
  status: string;
  count: number;
}

export async function getJobStatusBreakdown(): Promise<JobStatusRow[]> {
  const rows = await prisma.generationJob.groupBy({
    by: ["status"],
    where: { startedAt: { gte: last30d() } },
    _count: { id: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count.id }));
}

export interface JobFailureRow {
  id: string;
  kind: string;
  userEmail: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  processedItems: number;
  totalItems: number;
}

export async function getRecentJobFailures(limit = 20): Promise<JobFailureRow[]> {
  const rows = await prisma.generationJob.findMany({
    where: { status: "failed" },
    orderBy: { completedAt: "desc" },
    take: limit,
    include: { user: { select: { email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    userEmail: r.user.email,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    error: r.error,
    processedItems: r.processedItems,
    totalItems: r.totalItems,
  }));
}

export interface SendErrorRow {
  id: string;
  companyName: string;
  userEmail: string;
  sendError: string;
  sendAttempts: number;
  updatedAt: string;
}

export async function getRecentSendErrors(limit = 20): Promise<SendErrorRow[]> {
  const rows = await prisma.email.findMany({
    where: { sendError: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      company: {
        select: { name: true, user: { select: { email: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    companyName: r.company.name,
    userEmail: r.company.user.email,
    sendError: r.sendError ?? "",
    sendAttempts: r.sendAttempts,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface ErrorRateRow {
  d: string;
  rate: number;
  errors: number;
  total: number;
}

export async function getErrorRateTimeseries(
  range: RangeKey = "30d"
): Promise<ErrorRateRow[]> {
  const since = range === "7d" ? last7d() : last30d();
  const [errs, sends] = await Promise.all([
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', updatedAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE sendError IS NOT NULL AND updatedAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
    prisma.$queryRaw<Array<{ d: string; c: bigint | number }>>`
      SELECT strftime('%Y-%m-%d', sentAt) AS d, COUNT(*) AS c
      FROM Email
      WHERE sentAt IS NOT NULL AND sentAt >= ${since}
      GROUP BY d
      ORDER BY d ASC
    `,
  ]);

  const eMap = new Map(errs.map((r) => [r.d, toNumber(r.c)]));
  const sMap = new Map(sends.map((r) => [r.d, toNumber(r.c)]));
  const dates = new Set<string>([...eMap.keys(), ...sMap.keys()]);
  const merged: ErrorRateRow[] = Array.from(dates)
    .sort()
    .map((d) => {
      const errors = eMap.get(d) ?? 0;
      const sent = sMap.get(d) ?? 0;
      const total = errors + sent;
      return {
        d,
        errors,
        total,
        rate: total === 0 ? 0 : Math.round((errors / total) * 100),
      };
    });
  return fillMissingDays(merged, range, { errors: 0, total: 0, rate: 0 });
}
