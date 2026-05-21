import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { getUserDetail } from "@/lib/admin/queries";
import { KpiCard } from "@/components/admin/kpi-card";
import { MetricGrid } from "@/components/admin/metric-grid";
import { DonutChartCard } from "@/components/admin/donut-chart-card";
import { UserActionButtons } from "@/components/admin/user-action-buttons";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();

  return (
    <div className="px-8 py-8 space-y-8 max-w-[1400px] mx-auto">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <ArrowLeft className="h-3 w-3" />
          All tenants
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
              Tenant
            </div>
            <h1 className="mt-1 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
              {detail.name || detail.email}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-fg-muted)]">
              <span className="font-mono">{detail.email}</span>
              {detail.companyName && (
                <>
                  <span className="text-[var(--color-fg-subtle)]">·</span>
                  <span>{detail.companyName}</span>
                </>
              )}
              {detail.companyWebsite && (
                <>
                  <span className="text-[var(--color-fg-subtle)]">·</span>
                  <a
                    href={detail.companyWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    {detail.companyWebsite.replace(/^https?:\/\//, "")}
                  </a>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <StatusChip
                ok={!!detail.emailVerifiedAt}
                label={detail.emailVerifiedAt ? "Verified" : "Unverified"}
              />
              <StatusChip
                ok={!!detail.onboardingCompletedAt}
                label={
                  detail.onboardingCompletedAt
                    ? "Onboarded"
                    : detail.onboardingStep
                      ? `Step: ${detail.onboardingStep}`
                      : "No setup"
                }
              />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                Joined {formatDate(detail.createdAt)}
              </span>
            </div>
          </div>

          <UserActionButtons userId={detail.id} userEmail={detail.email} />
        </div>
      </div>

      <section>
        <MetricGrid columns={6}>
          <KpiCard
            label="Companies"
            value={detail.stats.totalCompanies}
            accent
          />
          <KpiCard
            label="Emails generated"
            value={detail.stats.emailsGenerated}
          />
          <KpiCard label="Emails sent" value={detail.stats.emailsSent} />
          <KpiCard label="Follow-ups" value={detail.stats.followUpsSent} />
          <KpiCard label="Clients won" value={detail.stats.clientsWon} />
          <KpiCard label="Active jobs" value={detail.stats.activeJobs} />
        </MetricGrid>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineOrEmpty
          rows={detail.stats.pipelineBreakdown}
          title="Pipeline state"
          empty="No companies yet."
        />
        <ClientStatusOrEmpty
          rows={detail.stats.clientsByStatus}
          title="Client status"
          empty="No emails sent yet."
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ConfigCard title="Integrations">
          <ConfigRow
            label="Apollo"
            ok={detail.hasApollo}
            value={detail.hasApollo ? "Configured" : "Missing key"}
          />
          <ConfigRow
            label="Gemini"
            ok={detail.hasGemini}
            value={detail.hasGemini ? "Configured" : "Missing key"}
          />
          <ConfigRow
            label="SMTP"
            ok={detail.smtp.verified}
            value={
              detail.smtp.provider
                ? `${detail.smtp.provider}${detail.smtp.user ? ` · ${detail.smtp.user}` : ""}`
                : "Not configured"
            }
          />
          {detail.smtp.senderEmail && (
            <ConfigRow
              label="Sender"
              ok={true}
              value={
                detail.smtp.senderName
                  ? `${detail.smtp.senderName} <${detail.smtp.senderEmail}>`
                  : detail.smtp.senderEmail
              }
            />
          )}
        </ConfigCard>
        <ConfigCard title="Automation">
          <ConfigRow
            label="Auto import"
            ok={detail.automationFlags.autoImport}
            value={detail.automationFlags.autoImport ? "On" : "Off"}
          />
          <ConfigRow
            label="Auto-approve initial"
            ok={detail.automationFlags.autoApproveInitial}
            value={detail.automationFlags.autoApproveInitial ? "On" : "Off"}
          />
          <ConfigRow
            label="Auto send"
            ok={detail.automationFlags.autoSend}
            value={detail.automationFlags.autoSend ? "On" : "Off"}
          />
          <ConfigRow
            label="Auto follow-up"
            ok={detail.automationFlags.autoFollowUp}
            value={detail.automationFlags.autoFollowUp ? "On" : "Off"}
          />
          <ConfigRow
            label="Auto-approve f/u"
            ok={detail.automationFlags.autoApproveFollowUp}
            value={detail.automationFlags.autoApproveFollowUp ? "On" : "Off"}
          />
        </ConfigCard>
        <ConfigCard title="Limits & schedule">
          <ConfigRow
            label="Daily import cap"
            ok={true}
            value={detail.dailyImportCap.toString()}
          />
          <ConfigRow
            label="Daily send cap"
            ok={true}
            value={detail.dailySendCap.toString()}
          />
          <ConfigRow
            label="Last automation run"
            ok={!!detail.automationLastRunAt}
            value={
              detail.automationLastRunAt
                ? formatRelative(detail.automationLastRunAt)
                : "Never run"
            }
          />
        </ConfigCard>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
          Recent activity
        </h2>
        <ActivityFeed rows={detail.recentActivity} />
      </section>
    </div>
  );
}

function PipelineOrEmpty({
  rows,
  title,
  empty,
}: {
  rows: { state: string; count: number }[];
  title: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] h-[240px] grid place-items-center text-[13px] text-[var(--color-fg-muted)]">
        {empty}
      </div>
    );
  }
  return (
    <DonutChartCard
      title={title}
      data={rows.map((r) => ({
        label: r.state.replaceAll("_", " "),
        value: r.count,
      }))}
    />
  );
}

function ClientStatusOrEmpty({
  rows,
  title,
  empty,
}: {
  rows: { status: string; count: number }[];
  title: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] h-[240px] grid place-items-center text-[13px] text-[var(--color-fg-muted)]">
        {empty}
      </div>
    );
  }
  return (
    <DonutChartCard
      title={title}
      data={rows.map((r) => ({
        label: r.status.replaceAll("_", " "),
        value: r.count,
      }))}
    />
  );
}

function ConfigCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-5">
      <div className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-[var(--color-fg-muted)] mb-3">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ConfigRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span
        className={cn(
          "grid h-4 w-4 place-items-center rounded shrink-0",
          ok
            ? "bg-[color-mix(in_oklch,var(--color-status-success)_18%,transparent)] text-[var(--color-status-success)]"
            : "bg-[var(--color-raised)] text-[var(--color-fg-subtle)]"
        )}
      >
        {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      </span>
      <span className="text-[var(--color-fg-muted)] w-[140px] shrink-0">
        {label}
      </span>
      <span className="text-[var(--color-fg)] truncate">{value}</span>
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono uppercase tracking-[0.06em]",
        ok
          ? "bg-[color-mix(in_oklch,var(--color-status-success)_18%,transparent)] text-[var(--color-status-success)]"
          : "bg-[var(--color-raised)] text-[var(--color-fg-muted)]"
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function ActivityFeed({
  rows,
}: {
  rows: Array<{
    id: string;
    performedAt: string;
    performedBy: string | null;
    entityType: string;
    entityId: string;
    action: string;
    fromState: string | null;
    toState: string | null;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
        No activity recorded.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] divide-y divide-[var(--color-line-soft)]">
      {rows.map((r) => (
        <div
          key={r.id}
          className="grid grid-cols-[140px_1fr_auto] items-center gap-4 px-5 py-2.5 text-[12.5px]"
        >
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
            {formatRelative(r.performedAt)}
          </span>
          <div>
            <span className="font-medium text-[var(--color-fg)]">
              {r.action.replaceAll("_", " ")}
            </span>
            {r.fromState && r.toState && (
              <span className="ml-2 font-mono text-[11px] text-[var(--color-fg-subtle)]">
                {r.fromState} → {r.toState}
              </span>
            )}
            {r.performedBy && (
              <span className="ml-2 text-[11.5px] text-[var(--color-fg-subtle)]">
                · {r.performedBy}
              </span>
            )}
          </div>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] bg-[var(--color-raised)] px-1.5 py-0.5 rounded">
            {r.entityType}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
