import Link from "next/link";
import {
  getClientStatusBreakdown,
  getOutcomesKpis,
  getOverdueFollowUps,
  getTopUsersByWonClients,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { DonutChartCard } from "@/components/admin/donut-chart-card";
import { BarChartCard } from "@/components/admin/bar-chart-card";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  contacted: "Contacted",
  replied: "Replied",
  in_progress: "In progress",
  won: "Won",
  lost: "Lost",
  no_reply: "No reply",
  snoozed: "Snoozed",
};

const STATUS_COLOR: Record<string, string> = {
  contacted: "var(--color-fg-muted)",
  replied: "var(--color-accent)",
  in_progress: "var(--color-accent-hover)",
  won: "var(--color-status-success)",
  lost: "var(--color-status-error)",
  no_reply: "var(--color-fg-subtle)",
  snoozed: "var(--color-status-pending)",
};

export default async function AdminOutcomesPage() {
  const [kpis, statusBreakdown, topUsers, overdue] = await Promise.all([
    getOutcomesKpis(),
    getClientStatusBreakdown(),
    getTopUsersByWonClients(8),
    getOverdueFollowUps(50),
  ]);

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Outcomes
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Client lifecycle
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          What happens after sends — replies, wins, losses, and follow-up debt.
        </p>
      </div>

      <section>
        <MetricGrid columns={6}>
          <KpiCard
            label="Active clients"
            value={kpis.totalClients}
            accent
            hint="post-send"
          />
          <KpiCard
            label="Reply rate"
            value={`${kpis.replyRatePct}%`}
            hint={`${kpis.replied + kpis.inProgress + kpis.won + kpis.lost} engaged`}
          />
          <KpiCard
            label="Win rate"
            value={`${kpis.winRatePct}%`}
            hint={`${kpis.won} won`}
          />
          <KpiCard label="Lost" value={kpis.lost} />
          <KpiCard label="No reply" value={kpis.noReply} />
          <KpiCard
            label="Overdue f/u"
            value={kpis.pendingFollowUp}
            hint="scheduled in past"
          />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {statusBreakdown.length === 0 ? (
          <EmptyCard message="No clients yet." />
        ) : (
          <DonutChartCard
            title="Client status"
            subtitle="Breakdown of all post-send clients"
            data={statusBreakdown.map((r) => ({
              label: STATUS_LABEL[r.status] ?? r.status,
              value: r.count,
              color: STATUS_COLOR[r.status],
            }))}
          />
        )}
        {topUsers.length === 0 ? (
          <EmptyCard message="No wins yet." />
        ) : (
          <BarChartCard
            title="Top tenants by wins"
            subtitle="Highest count of clients marked won"
            data={topUsers.map((u) => ({ label: u.email, value: u.won }))}
            height={240}
          />
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
            Overdue follow-ups
          </h2>
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
            Companies whose scheduled follow-up is in the past — surface for
            tenants who&apos;ve fallen behind on cadence.
          </p>
        </div>
        <OverdueTable rows={overdue} />
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

function OverdueTable({
  rows,
}: {
  rows: Array<{
    companyId: string;
    companyName: string;
    domain: string;
    nextFollowUpAt: string;
    followUpStep: number;
    userEmail: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
        Nothing overdue — every scheduled follow-up is current.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="grid grid-cols-[1fr_180px_100px_140px] px-5 py-2 border-b border-[var(--color-line-soft)] text-[10.5px] font-mono uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
        <div>Company</div>
        <div>Tenant</div>
        <div>Step</div>
        <div>Scheduled</div>
      </div>
      <div className="divide-y divide-[var(--color-line-soft)] max-h-[520px] overflow-auto">
        {rows.map((r) => (
          <Link
            key={r.companyId}
            href={`/admin/users/${encodeURIComponent(r.userEmail)}`}
            className="grid grid-cols-[1fr_180px_100px_140px] px-5 py-2.5 text-[12.5px] items-center hover:bg-[var(--color-raised)]/60 transition-colors"
          >
            <div className="min-w-0">
              <div className="font-medium text-[var(--color-fg)] truncate">
                {r.companyName}
              </div>
              <div className="font-mono text-[11px] text-[var(--color-fg-subtle)] truncate">
                {r.domain}
              </div>
            </div>
            <div className="font-mono text-[11.5px] text-[var(--color-fg-muted)] truncate">
              {r.userEmail}
            </div>
            <div className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg)]">
              {r.followUpStep === 0 ? "Initial" : `f/u ${r.followUpStep}`}
            </div>
            <div className="font-mono text-[11.5px] tabular-nums text-[var(--color-status-error)]">
              {overdueLabel(r.nextFollowUpAt)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function overdueLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (86400 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1d overdue";
  return `${days}d overdue`;
}
