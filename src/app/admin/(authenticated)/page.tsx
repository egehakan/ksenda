import {
  getEmailsSentByDay,
  getOverviewKpis,
  getPipelineBreakdown,
  getRecentActivity,
  type ActivityRow,
  type PipelineBreakdownRow,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { LineChartCard } from "@/components/admin/line-chart-card";
import { DonutChartCard } from "@/components/admin/donut-chart-card";
import { formatDayLabel } from "@/lib/admin/date-ranges";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [kpis, sentByDay, pipeline, activity] = await Promise.all([
    getOverviewKpis(),
    getEmailsSentByDay("30d"),
    getPipelineBreakdown(),
    getRecentActivity(40),
  ]);

  const sentChart = sentByDay.map((r) => ({
    ...r,
    label: formatDayLabel(r.d),
  }));

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <Header />

      <section className="space-y-3">
        <SectionHeading title="Key metrics" />
        <MetricGrid columns={6}>
          <KpiCard
            label="Tenants"
            value={kpis.totalUsers}
            hint="non-admin users"
          />
          <KpiCard
            label="Verified"
            value={kpis.verifiedUsers}
            hint={`${pct(kpis.verifiedUsers, kpis.totalUsers)}% of tenants`}
          />
          <KpiCard label="Companies" value={kpis.totalCompanies} />
          <KpiCard
            label="Emails sent"
            value={kpis.emailsSentAllTime}
            accent
            hint="initial + follow-up"
          />
          <KpiCard
            label="Clients won"
            value={kpis.clientsWon}
            hint={`${pct(kpis.clientsWon, kpis.totalCompanies)}% of companies`}
          />
          <KpiCard
            label="Active jobs"
            value={kpis.activeJobs}
            hint="running now"
          />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Emails sent — last 30 days"
            subtitle="Initial cold emails and follow-ups combined"
            data={sentChart}
            xKey="label"
            series={[
              { key: "initial", label: "Initial" },
              { key: "followup", label: "Follow-up" },
            ]}
            height={260}
          />
        </div>
        <PipelineDonut rows={pipeline} />
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Recent activity"
          subtitle={`${activity.length} most recent events across all tenants`}
        />
        <ActivityTable rows={activity} />
      </section>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Overview
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Operator dashboard
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          Cross-tenant view of usage, pipeline, and system health.
        </p>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function PipelineDonut({ rows }: { rows: PipelineBreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] h-[260px] grid place-items-center text-[13px] text-[var(--color-fg-muted)]">
        No companies yet
      </div>
    );
  }
  return (
    <DonutChartCard
      title="Pipeline state"
      subtitle="All companies across tenants"
      height={260}
      data={rows.map((r) => ({
        label: prettyState(r.state),
        value: r.count,
      }))}
    />
  );
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
        No activity recorded yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="grid grid-cols-[160px_1fr_180px_160px] px-5 py-2 border-b border-[var(--color-line-soft)] text-[10.5px] font-mono uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
        <div>When</div>
        <div>Action</div>
        <div>Entity</div>
        <div>Tenant</div>
      </div>
      <div className="divide-y divide-[var(--color-line-soft)] max-h-[520px] overflow-auto">
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[160px_1fr_180px_160px] px-5 py-2.5 text-[12.5px] items-center hover:bg-[var(--color-raised)]/40 transition-colors"
          >
            <div className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
              {relativeTime(r.performedAt)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--color-fg)] truncate">
                  {prettyAction(r.action)}
                </span>
                {r.fromState && r.toState && (
                  <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                    {r.fromState} → {r.toState}
                  </span>
                )}
              </div>
              {r.performedBy && (
                <div className="text-[11.5px] text-[var(--color-fg-subtle)] truncate">
                  by {r.performedBy}
                </div>
              )}
            </div>
            <div className="font-mono text-[11.5px] text-[var(--color-fg-muted)]">
              <span
                className={cn(
                  "inline-block px-1.5 py-0.5 rounded text-[10.5px] uppercase tracking-[0.08em] bg-[var(--color-raised)]"
                )}
              >
                {r.entityType}
              </span>
              <span className="ml-2 text-[var(--color-fg-subtle)] truncate">
                {r.entityId.slice(0, 12)}
              </span>
            </div>
            <div className="font-mono text-[11.5px] text-[var(--color-fg-muted)] truncate">
              {r.userEmail || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

function prettyState(state: string): string {
  return state.replaceAll("_", " ");
}

function prettyAction(action: string): string {
  return action.replaceAll("_", " ");
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

