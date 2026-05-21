import {
  getAutomationKpis,
  getAutomationRunsTimeseries,
  getRecipeUsage,
  getTodaysCampaignDays,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { BarChartCard } from "@/components/admin/bar-chart-card";
import { LineChartCard } from "@/components/admin/line-chart-card";
import { formatDayLabel } from "@/lib/admin/date-ranges";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminAutomationPage() {
  const [kpis, recipes, runs, today] = await Promise.all([
    getAutomationKpis(),
    getRecipeUsage(10),
    getAutomationRunsTimeseries("30d"),
    getTodaysCampaignDays(),
  ]);

  const runsChart = runs.map((r) => ({
    ...r,
    label: formatDayLabel(r.d),
  }));

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Automation
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Schedules & runs
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          Daily-cap utilization, recipe usage, and automation run success.
        </p>
      </div>

      <section>
        <MetricGrid columns={5}>
          <KpiCard
            label="Auto-send on"
            value={kpis.autoSendEnabled}
            accent
            hint="tenants with autosend"
          />
          <KpiCard
            label="Scheduled · 7d"
            value={kpis.scheduledNext7d}
            hint="campaign days ahead"
          />
          <KpiCard
            label="Cap usage today"
            value={`${kpis.capUtilizationPct}%`}
            hint="sent / sum of caps"
          />
          <KpiCard
            label="Run success"
            value={`${kpis.runSuccessRatePct}%`}
            hint={`${kpis.totalRunsLast30d} runs · 30d`}
          />
          <KpiCard
            label="Today's days"
            value={today.length}
            hint="across all tenants"
          />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Automation runs — last 30 days"
            subtitle="Completed and failed automation jobs per day"
            data={runsChart}
            xKey="label"
            series={[
              { key: "completed", label: "Completed", color: "var(--color-status-success)" },
              { key: "failed", label: "Failed", color: "var(--color-status-error)" },
            ]}
            height={260}
          />
        </div>
        {recipes.length === 0 ? (
          <EmptyCard message="No recipes used yet." />
        ) : (
          <BarChartCard
            title="Top recipes"
            subtitle="By scheduled-day count"
            data={recipes.map((r) => ({
              label: r.code,
              value: r.usage,
            }))}
            height={260}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
          Today&apos;s schedule
        </h2>
        <TodayTable rows={today} />
      </section>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] h-[260px] grid place-items-center text-[13px] text-[var(--color-fg-muted)]">
      {message}
    </div>
  );
}

function TodayTable({
  rows,
}: {
  rows: Array<{
    id: string;
    status: string;
    userEmail: string;
    recipeName: string | null;
    dailySendCap: number;
    outcomeSummary: string | null;
    ranAt: string | null;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
        No campaign days scheduled for today.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="grid grid-cols-[200px_1fr_140px_100px_140px] px-5 py-2 border-b border-[var(--color-line-soft)] text-[10.5px] font-mono uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
        <div>Tenant</div>
        <div>Recipe / outcome</div>
        <div>Status</div>
        <div>Cap</div>
        <div>Ran</div>
      </div>
      <div className="divide-y divide-[var(--color-line-soft)]">
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[200px_1fr_140px_100px_140px] px-5 py-2.5 text-[12.5px] items-center"
          >
            <span className="font-mono text-[11.5px] text-[var(--color-fg-muted)] truncate">
              {r.userEmail}
            </span>
            <div className="min-w-0">
              <div className="text-[var(--color-fg)]">
                {r.recipeName ?? "—"}
              </div>
              {r.outcomeSummary && (
                <div className="text-[11.5px] text-[var(--color-fg-muted)] truncate">
                  {r.outcomeSummary}
                </div>
              )}
            </div>
            <StatusChip status={r.status} />
            <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
              {r.dailySendCap}
            </span>
            <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
              {r.ranAt ? formatTime(r.ranAt) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    scheduled:
      "bg-[var(--color-raised)] text-[var(--color-fg-muted)]",
    skipped:
      "bg-[var(--color-raised)] text-[var(--color-fg-subtle)]",
    completed:
      "bg-[color-mix(in_oklch,var(--color-status-success)_18%,transparent)] text-[var(--color-status-success)]",
    failed:
      "bg-[color-mix(in_oklch,var(--color-status-error)_18%,transparent)] text-[var(--color-status-error)]",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded font-mono text-[10.5px] uppercase tracking-[0.08em] w-fit",
        colorMap[status] ?? "bg-[var(--color-raised)]"
      )}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
