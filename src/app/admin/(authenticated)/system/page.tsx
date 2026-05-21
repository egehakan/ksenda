import {
  getErrorRateTimeseries,
  getJobStatusBreakdown,
  getRecentJobFailures,
  getRecentSendErrors,
  getSystemKpis,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { LineChartCard } from "@/components/admin/line-chart-card";
import { BarChartCard } from "@/components/admin/bar-chart-card";
import { formatDayLabel } from "@/lib/admin/date-ranges";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  const [kpis, statusBreakdown, failures, sendErrors, errorRate] =
    await Promise.all([
      getSystemKpis(),
      getJobStatusBreakdown(),
      getRecentJobFailures(20),
      getRecentSendErrors(20),
      getErrorRateTimeseries("30d"),
    ]);

  const errorChart = errorRate.map((r) => ({
    ...r,
    label: formatDayLabel(r.d),
  }));

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          System
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Health & errors
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          Generation jobs, send errors, and stuck-job detection.
        </p>
      </div>

      <section>
        <MetricGrid columns={6}>
          <KpiCard
            label="Running"
            value={kpis.jobsRunning}
            accent={kpis.jobsRunning > 0}
            hint="active jobs"
          />
          <KpiCard
            label="Stuck"
            value={kpis.stuckJobs}
            hint="no heartbeat &gt; 5m"
          />
          <KpiCard
            label="Longest"
            value={`${kpis.longestRunningMinutes}m`}
            hint="oldest running"
          />
          <KpiCard
            label="Failed · 24h"
            value={kpis.jobsFailed24h}
            hint="generation jobs"
          />
          <KpiCard
            label="Send error rate"
            value={`${kpis.emailSendErrorRatePct}%`}
            hint="last 7d"
          />
          <KpiCard
            label="Total jobs · 30d"
            value={kpis.totalJobsLast30d}
          />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Send error rate — last 30 days"
            subtitle="Percentage of email attempts that errored"
            data={errorChart}
            xKey="label"
            series={[
              {
                key: "rate",
                label: "Error %",
                color: "var(--color-status-error)",
              },
            ]}
            height={240}
            yUnit="percent"
          />
        </div>
        {statusBreakdown.length === 0 ? (
          <EmptyCard message="No jobs in last 30 days." />
        ) : (
          <BarChartCard
            title="Job status · 30d"
            subtitle="GenerationJob breakdown"
            data={statusBreakdown.map((r) => ({
              label: r.status,
              value: r.count,
            }))}
            height={240}
          />
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FailuresTable rows={failures} />
        <SendErrorsTable rows={sendErrors} />
      </section>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] h-[240px] grid place-items-center text-[13px] text-[var(--color-fg-muted)]">
      {message}
    </div>
  );
}

function FailuresTable({
  rows,
}: {
  rows: Array<{
    id: string;
    kind: string;
    userEmail: string;
    completedAt: string | null;
    error: string | null;
    processedItems: number;
    totalItems: number;
  }>;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="px-5 pt-4 pb-2 border-b border-[var(--color-line-soft)]">
        <div className="text-[13px] font-semibold tracking-tight text-[var(--color-fg)]">
          Recent job failures
        </div>
        <p className="text-[11.5px] text-[var(--color-fg-muted)] mt-0.5">
          Last {rows.length} failed generation jobs
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
          No failures recorded.
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-line-soft)] max-h-[420px] overflow-auto">
          {rows.map((r) => (
            <div key={r.id} className="px-5 py-3 text-[12.5px]">
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-status-error)] bg-[color-mix(in_oklch,var(--color-status-error)_15%,transparent)] px-1.5 py-0.5 rounded">
                  {r.kind}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-fg-subtle)] truncate">
                  {r.userEmail}
                </span>
              </div>
              <div className="mt-2 text-[var(--color-fg)] font-mono text-[11.5px] line-clamp-2">
                {r.error || "Unknown error"}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                <span>
                  {r.processedItems}/{r.totalItems} items
                </span>
                {r.completedAt && (
                  <>
                    <span className="text-[var(--color-fg-subtle)]">·</span>
                    <span>{formatRelative(r.completedAt)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SendErrorsTable({
  rows,
}: {
  rows: Array<{
    id: string;
    companyName: string;
    userEmail: string;
    sendError: string;
    sendAttempts: number;
    updatedAt: string;
  }>;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="px-5 pt-4 pb-2 border-b border-[var(--color-line-soft)]">
        <div className="text-[13px] font-semibold tracking-tight text-[var(--color-fg)]">
          Recent send errors
        </div>
        <p className="text-[11.5px] text-[var(--color-fg-muted)] mt-0.5">
          Last {rows.length} email send attempts that errored
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
          No send errors.
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-line-soft)] max-h-[420px] overflow-auto">
          {rows.map((r) => (
            <div key={r.id} className="px-5 py-3 text-[12.5px]">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-[var(--color-fg)] truncate">
                  {r.companyName}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10.5px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded",
                    r.sendAttempts > 1
                      ? "bg-[color-mix(in_oklch,var(--color-status-error)_18%,transparent)] text-[var(--color-status-error)]"
                      : "bg-[var(--color-raised)] text-[var(--color-fg-muted)]"
                  )}
                >
                  {r.sendAttempts}× tried
                </span>
              </div>
              <div className="mt-2 text-[var(--color-fg)] font-mono text-[11.5px] line-clamp-2">
                {r.sendError}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                <span className="font-mono">{r.userEmail}</span>
                <span className="text-[var(--color-fg-subtle)]">·</span>
                <span>{formatRelative(r.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
