import {
  getFollowUpStepDistribution,
  getPipelineKpis,
  getPipelineTimeseries,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { LineChartCard } from "@/components/admin/line-chart-card";
import { BarChartCard } from "@/components/admin/bar-chart-card";
import { formatDayLabel } from "@/lib/admin/date-ranges";

export const dynamic = "force-dynamic";

const STEP_LABELS: Record<number, string> = {
  0: "Initial only",
  1: "After f/u #1",
  2: "After f/u #2",
  3: "After f/u #3",
};

export default async function AdminPipelinePage() {
  const [kpis, timeseries, stepDist] = await Promise.all([
    getPipelineKpis(),
    getPipelineTimeseries("30d"),
    getFollowUpStepDistribution(),
  ]);

  const chartData = timeseries.map((r) => ({
    ...r,
    label: formatDayLabel(r.d),
  }));

  const stepData = [0, 1, 2, 3].map((step) => {
    const row = stepDist.find((r) => r.step === step);
    return {
      label: STEP_LABELS[step] ?? `Step ${step}`,
      value: row?.count ?? 0,
    };
  });

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Pipeline
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Campaigns & email flow
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          Cross-tenant view of email generation, approval, and send activity.
        </p>
      </div>

      <section>
        <MetricGrid columns={6}>
          <KpiCard
            label="Companies"
            value={kpis.companiesTotal}
            hint={`+${kpis.companiesLast7d} this week`}
          />
          <KpiCard
            label="Emails generated"
            value={kpis.emailsGenerated}
            hint={`+${kpis.emailsGeneratedLast7d} this week`}
          />
          <KpiCard
            label="Emails sent"
            value={kpis.emailsSent}
            accent
            hint={`+${kpis.emailsSentLast7d} this week`}
          />
          <KpiCard
            label="Approval rate"
            value={`${kpis.approvalRatePct}%`}
            hint="approved / generated · 30d"
          />
          <KpiCard
            label="Send success"
            value={`${kpis.sendSuccessRatePct}%`}
            hint="sent / approved"
          />
          <KpiCard
            label="Follow-ups sent"
            value={kpis.followUpsSent}
            hint={`${kpis.avgSendAttempts} avg attempts`}
          />
        </MetricGrid>
      </section>

      <section>
        <LineChartCard
          title="Email flow — last 30 days"
          subtitle="Generated, approved, and sent per day across all tenants"
          data={chartData}
          xKey="label"
          series={[
            { key: "generated", label: "Generated" },
            { key: "approved", label: "Approved" },
            { key: "sent", label: "Sent" },
          ]}
          height={280}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Follow-up depth"
          subtitle="Companies grouped by follow-up step reached"
          data={stepData}
          height={240}
        />
        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-5 grid place-items-center">
          <div className="text-center max-w-[280px]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] mb-2">
              Engagement
            </div>
            <div className="text-[32px] font-semibold tabular-nums text-[var(--color-accent)]">
              {kpis.followUpsSent.toLocaleString()}
            </div>
            <p className="text-[12.5px] text-[var(--color-fg-muted)] mt-1">
              follow-up emails sent across all sequences
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
