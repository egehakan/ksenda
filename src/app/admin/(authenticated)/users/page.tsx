import {
  getAutomationAdoption,
  getOnboardingFunnel,
  getUserKpis,
  getUserListWithStats,
} from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { BarChartCard } from "@/components/admin/bar-chart-card";
import { UsersTable } from "@/components/admin/users-table";

export const dynamic = "force-dynamic";

const ONBOARDING_STEP_LABELS: Record<string, string> = {
  not_started: "Not started",
  profile: "Profile",
  api_keys: "API keys",
  email_provider: "Email provider",
  sender: "Sender",
  signature: "Signature",
  target_titles: "Target titles",
  done: "Done",
};

export default async function AdminUsersPage() {
  const [kpis, funnel, automation, userList] = await Promise.all([
    getUserKpis(),
    getOnboardingFunnel(),
    getAutomationAdoption(),
    getUserListWithStats(),
  ]);

  const funnelData = funnel
    .map((row) => ({
      label: ONBOARDING_STEP_LABELS[row.step] ?? row.step,
      value: row.count,
      step: row.step,
    }))
    .sort((a, b) => {
      const order = Object.keys(ONBOARDING_STEP_LABELS);
      return order.indexOf(a.step) - order.indexOf(b.step);
    });

  const automationData = [
    { label: "Import", value: automation.autoImport },
    { label: "Approve initial", value: automation.autoApproveInitial },
    { label: "Send", value: automation.autoSend },
    { label: "Follow-up", value: automation.autoFollowUp },
    { label: "Approve f/u", value: automation.autoApproveFollowUp },
  ];

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Users
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Tenants
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          All non-admin users with usage stats. Click any row to drill in.
        </p>
      </div>

      <section className="space-y-3">
        <MetricGrid columns={4}>
          <KpiCard
            label="Total tenants"
            value={kpis.totalUsers}
            accent
            hint={`${pct(kpis.onboardingCompleted, kpis.totalUsers)}% onboarded`}
          />
          <KpiCard
            label="Signups · 7d"
            value={kpis.signupsLast7d}
            hint={`${kpis.signupsLast30d} in last 30d`}
          />
          <KpiCard
            label="Apollo key"
            value={kpis.apolloAdopted}
            hint={`${pct(kpis.apolloAdopted, kpis.totalUsers)}% adoption`}
          />
          <KpiCard
            label="Gemini key"
            value={kpis.geminiAdopted}
            hint={`${pct(kpis.geminiAdopted, kpis.totalUsers)}% adoption`}
          />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Onboarding funnel"
          subtitle="Tenants by current step"
          data={funnelData.map(({ label, value }) => ({ label, value }))}
          height={260}
        />
        <BarChartCard
          title="Automation adoption"
          subtitle="Tenants with each toggle enabled"
          data={automationData}
          height={260}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
            All tenants
          </h2>
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
            {userList.length} {userList.length === 1 ? "user" : "users"}, newest first.
          </p>
        </div>
        <UsersTable rows={userList} />
      </section>
    </div>
  );
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}
