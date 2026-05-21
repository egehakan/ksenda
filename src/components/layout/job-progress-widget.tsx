"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Users,
  Send,
  Zap,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  HelpCircle,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Per-item event attached to a job — one row in the expanded list. */
interface JobDetail {
  id: string;
  jobId: string;
  name: string;
  status: string; // checking | no_ai | has_ai | unknown_ai | finding_contact | generating | pending_review | sent | failed
  detail: string | null;
  createdAt: string;
}

interface Job {
  id: string;
  userId: string;
  kind:
    | "company_import"
    | "people_import"
    | "company_search"
    | "people_search"
    | "followup_process"
    | "automation_run"
    | "single_generation"
    | "pipeline_send";
  status: "running" | "completed" | "failed";
  totalItems: number;
  processedItems: number;
  currentLabel: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  details?: JobDetail[];
}

/**
 * Global progress widget. Fixed bottom-right. Polls /api/jobs/active every
 * 2s while a job is in-flight; reverts to slow background polling
 * (10s) when idle so a freshly-started job surfaces quickly.
 *
 * Each job card has a chevron to expand into a scrollable per-item event
 * log: which companies are being AI-checked + verdicts, which contacts are
 * being looked up, which emails are being generated, and which rows failed.
 */
export function JobProgressWidget() {
  const queryClient = useQueryClient();
  const previousRunningIds = useRef<Set<string>>(new Set());
  /**
   * processedItems per running job from the previous poll. When the count
   * goes up between polls — i.e. another row finished generating / sending
   * mid-batch — we invalidate the pipeline queries so the Review / Approved
   * / Sent tabs reflect the new state without the user having to refresh.
   */
  const previousProgressRef = useRef<Map<string, number>>(new Map());
  /** Per-job total detail count so we also pick up per-row state changes
   *  that don't bump processedItems (e.g. finding_contact → generating). */
  const previousDetailCountRef = useRef<Map<string, number>>(new Map());

  const { data } = useQuery({
    queryKey: ["jobs-active"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/active");
      if (!res.ok) return { jobs: [] as Job[] };
      return res.json() as Promise<{ jobs: Job[] }>;
    },
    refetchInterval: (query) => {
      const jobs = (query.state.data as { jobs?: Job[] } | undefined)?.jobs ?? [];
      const hasRunning = jobs.some((j) => j.status === "running");
      return hasRunning ? 2_000 : 8_000;
    },
    staleTime: 1_000,
  });

  const jobs = useMemo(() => data?.jobs ?? [], [data]);

  useEffect(() => {
    if (jobs.length === 0) {
      previousRunningIds.current = new Set();
      previousProgressRef.current = new Map();
      previousDetailCountRef.current = new Map();
      return;
    }

    // ---------------------------------------------------------------------
    // 1. Live progress invalidation. Fires while a job is running, every
    // time it makes forward progress (processedItems bump OR a new detail
    // entry was appended). This is what makes the Review tab grow in
    // realtime as each email finishes generating.
    // ---------------------------------------------------------------------
    let liveProgressed = false;
    const liveTouchedKinds: Job["kind"][] = [];
    for (const job of jobs) {
      if (job.status !== "running") continue;
      const prevProcessed = previousProgressRef.current.get(job.id) ?? 0;
      const prevDetails = previousDetailCountRef.current.get(job.id) ?? 0;
      const currentDetails = job.details?.length ?? 0;
      if (job.processedItems > prevProcessed || currentDetails > prevDetails) {
        liveProgressed = true;
        liveTouchedKinds.push(job.kind);
      }
      previousProgressRef.current.set(job.id, job.processedItems);
      previousDetailCountRef.current.set(job.id, currentDetails);
    }
    if (liveProgressed) {
      // Pipeline tabs + counts always update when ANY job makes progress.
      queryClient.invalidateQueries({ queryKey: ["pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      // Kind-specific surfaces get refreshed only if relevant.
      if (
        liveTouchedKinds.includes("followup_process") ||
        liveTouchedKinds.includes("automation_run")
      ) {
        queryClient.invalidateQueries({ queryKey: ["clients"] });
        queryClient.invalidateQueries({ queryKey: ["followups"] });
      }
      if (liveTouchedKinds.includes("automation_run")) {
        queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
        queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
      }
    }

    // ---------------------------------------------------------------------
    // 2. End-of-job invalidation. Fires once when a tracked-running job
    // transitions to completed/failed — catches any final state the
    // per-tick invalidator might have missed, plus surfaces that don't
    // see progress events (e.g. automation post-run summary).
    // ---------------------------------------------------------------------
    const justFinished = jobs.filter(
      (j) => j.status !== "running" && previousRunningIds.current.has(j.id)
    );

    if (justFinished.length > 0) {
      const keysToInvalidate = new Set<string>();
      for (const job of justFinished) {
        keysToInvalidate.add("pipeline-stats");
        keysToInvalidate.add("companies");
        switch (job.kind) {
          case "company_import":
          case "people_import":
          case "single_generation":
          case "pipeline_send":
            break;
          case "followup_process":
            keysToInvalidate.add("clients");
            keysToInvalidate.add("followups");
            break;
          case "automation_run":
            keysToInvalidate.add("clients");
            keysToInvalidate.add("followups");
            keysToInvalidate.add("campaign-schedule");
            keysToInvalidate.add("automation-settings");
            break;
        }
        // Clean up tracking maps now that the job is done.
        previousProgressRef.current.delete(job.id);
        previousDetailCountRef.current.delete(job.id);
      }
      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    }

    previousRunningIds.current = new Set(
      jobs.filter((j) => j.status === "running").map((j) => j.id)
    );
  }, [jobs, queryClient]);

  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 max-w-[420px] w-[calc(100vw-3rem)]">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const { Icon, title } = kindMeta(job.kind, readChannel(job));
  const pct =
    job.totalItems > 0
      ? Math.min(100, Math.round((job.processedItems / job.totalItems) * 100))
      : null;
  const isRunning = job.status === "running";
  const isFailed = job.status === "failed";
  const [expanded, setExpanded] = useState(false);

  const subtitle = useMemo(() => {
    if (isFailed) return job.error || "Failed";
    if (job.status === "completed") return summarizeCompleted(job);
    if (job.currentLabel) return job.currentLabel;
    if (job.totalItems > 0) {
      return `${job.processedItems} of ${job.totalItems}`;
    }
    return "Working…";
  }, [job, isFailed]);

  // Build the visible list by:
  //   1) Sorting raw detail rows by createdAt DESC (newest first).
  //   2) Keeping only the LATEST row per company name — a company that's
  //      transitioned checking → no_ai shows up once, as no_ai.
  //   3) Re-sorting by status tier: done (verdicts / pending_review / sent /
  //      failed) on top, currently-active (checking / generating / contact
  //      lookup) below, ties broken by createdAt DESC inside each tier.
  const orderedDetails = useMemo(() => {
    const d = job.details ?? [];
    // Newest first so the dedupe loop keeps the most recent status per name.
    const byTime = [...d].sort((a, b) =>
      a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0
    );
    const seen = new Set<string>();
    const deduped: JobDetail[] = [];
    for (const row of byTime) {
      const key = row.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    deduped.sort((a, b) => {
      const ra = statusRank(a.status);
      const rb = statusRank(b.status);
      if (ra !== rb) return ra - rb;
      // Within the same tier, newest first so the just-completed row sits
      // at the top of the "done" group and the just-started row sits at
      // the top of the "active" group.
      return a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0;
    });
    return deduped;
  }, [job.details]);

  const detailCount = orderedDetails.length;
  const hasDetails = detailCount > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--color-panel)] shadow-lg backdrop-blur",
        "border-[var(--color-line-soft)]",
        isFailed && "border-[var(--color-status-error)]/40"
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <div
          className={cn(
            "shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-md",
            isFailed
              ? "bg-[var(--color-status-error)]/15 text-[var(--color-status-error)]"
              : job.status === "completed"
              ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
              : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          )}
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isFailed ? (
            <AlertCircle className="h-4 w-4" />
          ) : job.status === "completed" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium truncate text-[var(--color-fg)]">
              {title}
            </div>
            {pct !== null && isRunning && (
              <div className="text-xs tabular-nums text-muted-foreground shrink-0">
                {pct}%
              </div>
            )}
          </div>
          <div
            className={cn(
              "mt-0.5 text-xs leading-relaxed truncate",
              isFailed
                ? "text-[var(--color-status-error)]"
                : "text-muted-foreground"
            )}
          >
            {subtitle}
          </div>
          {pct !== null && isRunning && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-line-soft)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
            >
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {expanded ? "Hide" : "Show"} per-item log ({detailCount})
            </button>
          )}
        </div>
      </div>
      {expanded && hasDetails && (
        <div className="border-t border-[var(--color-line-soft)] max-h-[260px] overflow-y-auto">
          {orderedDetails.map((d) => (
            <DetailRow key={d.id} detail={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ detail }: { detail: JobDetail }) {
  const meta = statusMeta(detail.status);
  const Icon = meta.Icon;
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--color-line-soft)] last:border-b-0">
      <Icon
        className={cn(
          "h-3 w-3 mt-1 shrink-0",
          meta.color,
          // Spin ONLY applies to the icon, never the label.
          meta.spin && "animate-spin"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="truncate text-[12px] text-[var(--color-fg)] font-medium">
            {detail.name}
          </span>
          <span
            className={cn(
              "font-mono text-[9.5px] uppercase tracking-[0.05em] shrink-0",
              meta.color
            )}
          >
            {meta.label}
          </span>
        </div>
        {detail.detail && (
          <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)] line-clamp-2">
            {detail.detail}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tier ordering for the expanded log:
 *   0 = done (verdict or final outcome)
 *   1 = active (currently being processed)
 *   2 = anything else (unknown / pending start)
 */
function statusRank(status: string): number {
  switch (status) {
    case "no_ai":
    case "has_ai":
    case "pending_review":
    case "sent":
    case "failed":
      return 0;
    case "checking":
    case "finding_contact":
    case "generating":
      return 1;
    case "unknown_ai":
      return 0;
    default:
      return 2;
  }
}

function statusMeta(status: string): {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Color class applied to both the icon and the uppercase label. */
  color: string;
  /** When true, the icon spins (the label never spins). */
  spin?: boolean;
} {
  switch (status) {
    // AI detection lifecycle
    case "checking":
      return {
        label: "checking",
        Icon: Loader2,
        color: "text-[var(--color-accent)]",
        spin: true,
      };
    case "no_ai":
      return {
        label: "no AI",
        Icon: CircleSlash,
        color: "text-[var(--color-status-success)]",
      };
    case "has_ai":
      return {
        label: "has AI",
        Icon: Sparkles,
        color: "text-[var(--color-fg-subtle)]",
      };
    case "unknown_ai":
      return {
        label: "unknown",
        Icon: HelpCircle,
        color: "text-[var(--color-fg-muted)]",
      };
    // Per-row import lifecycle
    case "finding_contact":
      return {
        label: "finding contact",
        Icon: Users,
        color: "text-[var(--color-accent)]",
      };
    case "generating":
      return {
        label: "generating email",
        Icon: Sparkles,
        color: "text-[var(--color-accent)]",
      };
    case "generating_linkedin":
      return {
        label: "generating LinkedIn message",
        Icon: Sparkles,
        color: "text-[var(--color-accent)]",
      };
    case "pending_review":
      return {
        label: "ready to review",
        Icon: CheckCircle2,
        color: "text-[var(--color-status-success)]",
      };
    case "sent":
      return {
        label: "sent",
        Icon: Send,
        color: "text-[var(--color-status-success)]",
      };
    case "failed":
      return {
        label: "failed",
        Icon: AlertCircle,
        color: "text-[var(--color-status-error)]",
      };
    default:
      return {
        label: status,
        Icon: HelpCircle,
        color: "text-[var(--color-fg-muted)]",
      };
  }
}

function readChannel(job: Job): "email" | "linkedin" | undefined {
  const raw = (job as unknown as { metadataJson?: string | null }).metadataJson;
  if (!raw) return undefined;
  try {
    const m = JSON.parse(raw) as { channel?: string };
    return m.channel === "linkedin" ? "linkedin" : m.channel === "email" ? "email" : undefined;
  } catch {
    return undefined;
  }
}

function kindMeta(
  kind: Job["kind"],
  channel?: "email" | "linkedin"
): {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  const ch = channel === "linkedin" ? "LinkedIn message" : "email";
  switch (kind) {
    case "company_import":
      return { title: `Generating company ${ch}s`, Icon: Sparkles };
    case "people_import":
      return { title: `Generating people ${ch}s`, Icon: Sparkles };
    case "company_search":
      return { title: "Searching companies", Icon: Search };
    case "people_search":
      return { title: "Searching people", Icon: Search };
    case "followup_process":
      return { title: "Generating follow-ups", Icon: Send };
    case "automation_run":
      return { title: "Running today's plan", Icon: Zap };
    case "single_generation":
      return { title: `Generating ${ch}`, Icon: Sparkles };
    case "pipeline_send":
      return { title: "Sending emails", Icon: Send };
    default:
      return { title: "Working", Icon: Sparkles };
  }
}

function summarizeCompleted(job: Job): string {
  const raw = (job as unknown as { metadataJson?: string }).metadataJson;
  if (!raw) return `Done · ${job.processedItems}/${job.totalItems}`;
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    const channel = m.channel === "linkedin" ? "linkedin" : "email";
    const noun = channel === "linkedin" ? "LinkedIn message" : "email";
    const parts: string[] = [];
    if (typeof m.imported === "number" && m.imported > 0) parts.push(`imported ${m.imported}`);
    if (typeof m.emailsGenerated === "number" && m.emailsGenerated > 0)
      parts.push(`${m.emailsGenerated} ${noun}${m.emailsGenerated === 1 ? "" : "s"}`);
    if (typeof m.autoSent === "number" && m.autoSent > 0) parts.push(`sent ${m.autoSent}`);
    if (typeof m.generated === "number" && m.generated > 0)
      parts.push(`generated ${m.generated}`);
    if (typeof m.sentInitial === "number" && m.sentInitial > 0)
      parts.push(`sent ${m.sentInitial} initial`);
    if (typeof m.sentFollowUp === "number" && m.sentFollowUp > 0)
      parts.push(`sent ${m.sentFollowUp} follow-ups`);
    if (typeof m.detected === "number" && m.detected > 0)
      parts.push(`${m.detected} AI checks`);
    return parts.length > 0
      ? `Done · ${parts.join(" · ")}`
      : `Done · ${job.processedItems}/${job.totalItems}`;
  } catch {
    return `Done · ${job.processedItems}/${job.totalItems}`;
  }
}
