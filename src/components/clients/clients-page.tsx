"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Plus,
  Play,
  X,
  Pencil,
  Linkedin,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAccountBusy } from "@/hooks/use-account-busy";
import {
  LinkedInSendModal,
  type LinkedInRowInput,
} from "@/components/pipeline/linkedin-send-modal";

// Follow-up filter pills, keyed by the count returned from /api/clients.
// Tokens prefixed "fu:" so the query layer can route them to the right
// API param without colliding with clientStatus ids.
const FOLLOWUP_FILTERS: { id: string; label: string; countKey: "pending" | "step1" | "step2" | "step3" }[] = [
  { id: "fu:pending", label: "Needs review", countKey: "pending" },
  { id: "fu:1", label: "Follow Up 1", countKey: "step1" },
  { id: "fu:2", label: "Follow Up 2", countKey: "step2" },
  { id: "fu:3", label: "Follow Up 3", countKey: "step3" },
];

type FollowUpCounts = {
  step1: number;
  step2: number;
  step3: number;
  pending: number;
};

const STATUSES: { id: string; label: string; tone: "default" | "warm" | "muted" | "good" | "bad" }[] = [
  { id: "contacted", label: "Awaiting reply", tone: "default" },
  { id: "replied", label: "Replied", tone: "warm" },
  { id: "in_progress", label: "In progress", tone: "warm" },
  { id: "won", label: "Won", tone: "good" },
  { id: "lost", label: "Lost", tone: "bad" },
  { id: "no_reply", label: "No reply (sequence done)", tone: "muted" },
  { id: "snoozed", label: "Snoozed", tone: "muted" },
];

interface Client {
  id: string;
  name: string;
  domain: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  employeeCount?: number | null;
  isManual: boolean;
  pipelineState: string;
  targetContactFirstName?: string | null;
  targetContactLastName?: string | null;
  targetContactEmail?: string | null;
  targetContactLinkedinUrl?: string | null;
  targetContactTitle?: string | null;
  clientStatus: string | null;
  clientStatusUpdatedAt: string | null;
  clientNote: string | null;
  nextFollowUpAt: string | null;
  followUpStep: number;
  email?: {
    id: string;
    channel?: string | null;
    subject?: string | null;
    body: string;
    finalSubject?: string | null;
    finalBody?: string | null;
    sentAt?: string | null;
  } | null;
  followUpEmails: Array<{
    id: string;
    step: number;
    channel?: string | null;
    subject?: string | null;
    body: string;
    editedSubject?: string | null;
    editedBody?: string | null;
    finalSubject?: string | null;
    finalBody?: string | null;
    sentAt?: string | null;
    approvedAt?: string | null;
    reviewedAt?: string | null;
    sendError?: string | null;
  }>;
}

export function ClientsPage() {
  const queryClient = useQueryClient();
  // A search / import / generation / automation / follow-up job already in
  // flight disables "Run follow-ups now" (the API also hard-blocks 409).
  const { busy: accountBusy, label: busyLabel } = useAccountBusy();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<"all" | "email" | "linkedin">("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [linkedinRows, setLinkedinRows] = useState<LinkedInRowInput[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["clients", activeFilter, channelFilter, page],
    queryFn: async () => {
      const url = new URL("/api/clients", window.location.origin);
      if (activeFilter) {
        if (activeFilter === "fu:pending") {
          url.searchParams.set("fuPending", "true");
        } else if (activeFilter.startsWith("fu:")) {
          url.searchParams.set("fuStep", activeFilter.slice(3));
        } else {
          url.searchParams.set("status", activeFilter);
        }
      }
      url.searchParams.set("channel", channelFilter);
      url.searchParams.set("page", String(page));
      url.searchParams.set("perPage", String(PER_PAGE));
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load clients");
      return res.json() as Promise<{
        clients: Client[];
        statusCounts: Record<string, number>;
        followUpCounts: FollowUpCounts;
        total?: number;
        page?: number;
        perPage?: number;
      }>;
    },
    staleTime: 0,
  });

  const clients = data?.clients || [];
  const statusCounts = data?.statusCounts || {};
  const followUpCounts = data?.followUpCounts || {
    step1: 0,
    step2: 0,
    step3: 0,
    pending: 0,
  };
  const totalCount = data?.total ?? Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

  // Clear selection whenever the filter changes — the visible set changes
  // under it, mirroring the Pipeline tab's behaviour.
  const handleFilterChange = (next: string | null) => {
    setActiveFilter(next);
    setSelectedIds(new Set());
    setPage(1);
  };
  const handleChannelChange = (next: "all" | "email" | "linkedin") => {
    setChannelFilter(next);
    setSelectedIds(new Set());
    setPage(1);
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  // A client is "actionable" by the batch bar only if it has at least one
  // unsent generated follow-up draft.
  const clientHasPendingFollowUp = (c: Client) =>
    c.followUpEmails.some((f) => !f.sentAt);
  const selectableClients = clients.filter(clientHasPendingFollowUp);
  const allSelectableSelected =
    selectableClients.length > 0 &&
    selectableClients.every((c) => selectedIds.has(c.id));
  const selectedClients = clients.filter((c) => selectedIds.has(c.id));
  const selectedPendingCount = selectedClients.filter(clientHasPendingFollowUp).length;
  const selectedClientChannels = new Set(
    selectedClients.map((c) => (c.email?.channel || "email") as "email" | "linkedin")
  );
  const isMixedChannelSelection =
    selectedClientChannels.has("email") && selectedClientChannels.has("linkedin");
  const isLinkedInOnlySelection =
    selectedClientChannels.size === 1 && selectedClientChannels.has("linkedin");

  const selectAllPending = () =>
    setSelectedIds(new Set(selectableClients.map((c) => c.id)));

  // Helper: pull the first unsent follow-up off a client (the one batch-send
  // would normally send).
  const pendingFollowUpOf = (c: Client) =>
    c.followUpEmails.find((f) => !f.sentAt) || null;

  const openLinkedInBatch = () => {
    const rows: LinkedInRowInput[] = selectedClients
      .map((c) => {
        const fu = pendingFollowUpOf(c);
        if (!fu) return null;
        const message =
          fu.finalBody || fu.editedBody || fu.body || "";
        return {
          id: fu.id,
          contactName:
            [c.targetContactFirstName, c.targetContactLastName].filter(Boolean).join(" ") ||
            c.name,
          subline:
            [c.targetContactTitle, c.name, `Follow-up ${fu.step}`].filter(Boolean).join(" · "),
          linkedinUrl: c.targetContactLinkedinUrl ?? null,
          message,
        } as LinkedInRowInput;
      })
      .filter((r): r is LinkedInRowInput => r !== null);
    setLinkedinRows(rows);
    setLinkedinModalOpen(true);
  };

  const batchSendMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await fetch("/api/followups/batch-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Batch send failed");
      }
      return res.json() as Promise<{
        sent: number;
        failed: number;
        skipped: number;
        errors: Array<{ companyName: string; error: string }>;
      }>;
    },
    onSuccess: (r) => {
      const parts = [`${r.sent} sent`];
      if (r.failed) parts.push(`${r.failed} failed`);
      if (r.skipped) parts.push(`${r.skipped} skipped`);
      setBatchResult(parts.join(" · "));
      clearSelection();
      refetch();
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      setTimeout(() => setBatchResult(null), 8000);
    },
    onError: (e: any) => {
      setBatchResult(`Failed: ${e?.message || "unknown error"}`);
      setTimeout(() => setBatchResult(null), 8000);
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/followups/process", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to process");
      }
      return res.json() as Promise<{
        success: boolean;
        queued?: boolean;
        message?: string;
      }>;
    },
    onSuccess: (r) => {
      setProcessResult(
        r.message || "Follow-up run queued. Watch the jobs widget."
      );
      refetch();
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      setTimeout(() => setProcessResult(null), 8000);
    },
    onError: (e: any) => {
      setProcessResult(`Failed: ${e?.message || "unknown error"}`);
      setTimeout(() => setProcessResult(null), 8000);
    },
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalCount} {totalCount === 1 ? "client" : "clients"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {(batchResult || processResult) && (
            <span className="text-xs text-muted-foreground hidden md:inline">
              {batchResult || processResult}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending || accountBusy}
            title={
              accountBusy
                ? busyLabel
                  ? `Busy: ${busyLabel}`
                  : "A job is already running for this account."
                : undefined
            }
          >
            {processMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run follow-ups now
              </>
            )}
          </Button>
          <Button size="sm" onClick={() => setAddModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <FilterPill
          label="All"
          count={totalCount}
          isActive={activeFilter === null}
          onClick={() => handleFilterChange(null)}
        />
        {STATUSES.map((s) => (
          <FilterPill
            key={s.id}
            label={s.label}
            count={statusCounts[s.id] || 0}
            tone={s.tone}
            isActive={activeFilter === s.id}
            onClick={() => handleFilterChange(s.id)}
          />
        ))}
      </div>

      {/* Follow-up stage filter pills — by follow-ups actually sent, plus a
          "Needs review" bucket for unsent generated drafts. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] pr-1">
          Follow-up stage
        </span>
        {FOLLOWUP_FILTERS.map((f) => (
          <FilterPill
            key={f.id}
            label={f.label}
            count={followUpCounts[f.countKey] || 0}
            tone={f.id === "fu:pending" ? "warm" : "default"}
            isActive={activeFilter === f.id}
            onClick={() => handleFilterChange(f.id)}
          />
        ))}
      </div>

      {/* Channel filter (Email / LinkedIn / All) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] pr-1">
          Channel
        </span>
        <div
          role="radiogroup"
          aria-label="Channel filter"
          className="inline-flex w-fit overflow-hidden rounded-md border border-[var(--color-line)]"
        >
          {(
            [
              ["all", "All"],
              ["email", "Email"],
              ["linkedin", "LinkedIn"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={channelFilter === key}
              onClick={() => handleChannelChange(key)}
              className={
                "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-none transition-colors px-3 py-1.5 border-l border-[var(--color-line)] first:border-l-0 " +
                (channelFilter === key
                  ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Client list */}
      {isLoading ? (
        <div className="flex items-center gap-3 py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading clients…
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] py-16 px-6 text-center">
          <p className="text-sm font-medium text-[var(--color-fg)]">
            No clients here yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a first email from the Pipeline tab, or click Add client to enter one manually.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {selectableClients.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground tabular-nums">
                {selectableClients.length} with a follow-up awaiting review
              </span>
              <button
                type="button"
                onClick={
                  allSelectableSelected ? clearSelection : selectAllPending
                }
                className="text-xs text-muted-foreground hover:text-[var(--color-fg)] transition-colors duration-150"
              >
                {allSelectableSelected
                  ? "Deselect all"
                  : "Select all awaiting review"}
              </button>
            </div>
          )}
          <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden shadow-sm divide-y divide-[var(--color-line-soft)]">
            {clients.map((c) => (
              <ClientRow
                key={c.id}
                client={c}
                selectable={clientHasPendingFollowUp(c)}
                isSelected={selectedIds.has(c.id)}
                onToggleSelect={() => toggleSelect(c.id)}
                onSelect={() => setSelectedClient(c)}
              />
            ))}
          </div>
          {totalCount > PER_PAGE && (
            <div className="flex items-center justify-between gap-3 px-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
              <span className="tabular-nums">
                {(page - 1) * PER_PAGE + 1}
                {"–"}
                {Math.min(page * PER_PAGE, totalCount)} of {totalCount}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="First page"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="tabular-nums px-2">
                  page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Last page"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail rail */}
      {selectedClient && (
        <ClientDetailRail
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onUpdated={() => {
            refetch();
            setSelectedClient(null);
          }}
        />
      )}

      {/* Add modal */}
      <AddClientDialog
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdded={() => {
          setAddModalOpen(false);
          refetch();
        }}
      />

      <LinkedInSendModal
        isOpen={linkedinModalOpen}
        onClose={() => {
          setLinkedinModalOpen(false);
          setLinkedinRows([]);
        }}
        rows={linkedinRows}
        source="followup"
        onSuccess={() => {
          const parts = [`${linkedinRows.length} marked sent`];
          setBatchResult(parts.join(" · "));
          clearSelection();
          refetch();
          queryClient.invalidateQueries({ queryKey: ["followups"] });
          setTimeout(() => setBatchResult(null), 8000);
        }}
      />

      {/* Batch action bar — approve + send pending follow-ups for the
          selected clients in one shot. Pinned flat to the bottom edge,
          same treatment as the Pipeline tab. */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line-strong)] bg-[var(--color-canvas)]/95 backdrop-blur-sm">
          <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-5">
            <span className="font-mono text-[12px] text-[var(--color-fg)] tabular-nums">
              {selectedIds.size}
              <span className="ml-2 uppercase tracking-[0.08em] text-[10.5px] text-[var(--color-fg-muted)]">
                selected
              </span>
              {selectedPendingCount !== selectedIds.size && (
                <span className="ml-2 text-[10.5px] text-[var(--color-fg-subtle)]">
                  ({selectedPendingCount} with a follow-up to send)
                </span>
              )}
            </span>

            <div className="h-5 w-px bg-[var(--color-line)]" aria-hidden />

            <div className="flex items-center gap-2 flex-1">
              <Button
                size="sm"
                onClick={() => {
                  if (isLinkedInOnlySelection) {
                    openLinkedInBatch();
                  } else {
                    batchSendMutation.mutate([...selectedIds]);
                  }
                }}
                disabled={
                  batchSendMutation.isPending ||
                  selectedPendingCount === 0 ||
                  isMixedChannelSelection
                }
                title={
                  isMixedChannelSelection
                    ? "Email and LinkedIn must be sent separately."
                    : undefined
                }
              >
                {batchSendMutation.isPending && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {isLinkedInOnlySelection
                  ? `Open LinkedIn · ${selectedPendingCount || ""} follow-up${
                      selectedPendingCount === 1 ? "" : "s"
                    }`
                  : `Approve + send ${selectedPendingCount || ""} follow-up${
                      selectedPendingCount === 1 ? "" : "s"
                    }`}
              </Button>
              {isMixedChannelSelection && (
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-status-error)]">
                  Email and LinkedIn must be sent separately
                </span>
              )}
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={batchSendMutation.isPending}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  tone?: "default" | "warm" | "muted" | "good" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors duration-150",
        isActive
          ? "bg-[var(--color-accent-soft)] text-[var(--color-fg)] ring-1 ring-[var(--color-accent)]"
          : "bg-[var(--color-panel)] text-[var(--color-fg-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-fg)]"
      )}
    >
      <span>{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function ClientRow({
  client,
  selectable,
  isSelected,
  onToggleSelect,
  onSelect,
}: {
  client: Client;
  selectable: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onSelect: () => void;
}) {
  const status = STATUSES.find((s) => s.id === client.clientStatus);
  const pendingFollowUps = client.followUpEmails.filter((f) => !f.sentAt).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "grid grid-cols-[24px_16px_minmax(0,1fr)] md:grid-cols-[24px_16px_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,140px)_minmax(0,90px)] gap-x-3 md:gap-x-4 items-center px-4 sm:px-5 py-4 cursor-pointer hover:bg-[var(--color-raised)] transition-colors duration-150",
        isSelected && "bg-[var(--color-accent-soft)]/40"
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center"
      >
        {selectable ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect()}
            aria-label={`Select ${client.name}`}
          />
        ) : (
          <span
            className="inline-block h-4 w-4"
            aria-hidden
            title="No follow-up awaiting review"
          />
        )}
      </div>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background:
            status?.tone === "good"
              ? "var(--color-accent)"
              : status?.tone === "bad"
              ? "var(--color-status-error)"
              : status?.tone === "muted"
              ? "var(--color-fg-subtle)"
              : status?.tone === "warm"
              ? "var(--color-accent)"
              : "var(--color-fg-muted)",
        }}
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--color-fg)] flex items-center gap-2">
          {client.name}
          {(client.email?.channel || "email") === "linkedin" && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10 shrink-0"
              title="LinkedIn outreach"
            >
              <Linkedin className="h-2.5 w-2.5" />
              LI
            </span>
          )}
          {client.isManual && (
            <span className="inline-flex items-center rounded-full bg-[var(--color-panel)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              manual
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {client.targetContactFirstName}{" "}
          {client.targetContactLastName || ""}
          {client.targetContactTitle && ` · ${client.targetContactTitle}`}
        </div>
        {/* Mobile-only condensed detail — the dedicated columns are md+. */}
        <div className="md:hidden mt-1.5 space-y-0.5">
          <div className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
            {client.targetContactEmail || "—"}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
            <span className="text-[var(--color-fg)] font-medium">
              {status?.label || client.clientStatus}
            </span>
            <span>· Step {client.followUpStep}/3</span>
            <span>
              ·{" "}
              {client.nextFollowUpAt
                ? formatRel(new Date(client.nextFollowUpAt))
                : "—"}
            </span>
          </div>
          {pendingFollowUps > 0 && (
            <div className="text-[11px] text-[var(--color-accent)]">
              {pendingFollowUps} follow-up{pendingFollowUps === 1 ? "" : "s"}{" "}
              pending review
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 hidden md:block">
        <div className="truncate text-sm text-[var(--color-fg)]">
          {client.targetContactEmail || "—"}
        </div>
        {pendingFollowUps > 0 && (
          <div className="mt-0.5 text-xs text-[var(--color-accent)]">
            {pendingFollowUps} follow-up{pendingFollowUps === 1 ? "" : "s"} pending review
          </div>
        )}
      </div>
      <div className="hidden md:block text-right text-xs">
        <div className="text-[var(--color-fg)] font-medium">
          {status?.label || client.clientStatus}
        </div>
        <div className="mt-0.5 text-muted-foreground tabular-nums">
          Step {client.followUpStep}/3
        </div>
      </div>
      <div className="hidden md:block text-right text-xs tabular-nums text-muted-foreground">
        {client.nextFollowUpAt
          ? formatRel(new Date(client.nextFollowUpAt))
          : "—"}
      </div>
    </div>
  );
}

function formatRel(date: Date): string {
  const ms = date.getTime() - Date.now();
  const abs = Math.abs(ms);
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (abs < 60 * 60 * 1000) return "due now";
  if (abs < 48 * 60 * 60 * 1000) {
    return ms < 0 ? `${Math.abs(hours)}h overdue` : `in ${hours}h`;
  }
  return ms < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`;
}

function ClientDetailRail({
  client,
  onClose,
  onUpdated,
}: {
  client: Client;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(client.clientNote || "");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  // Follow-up inline editing. `editingId` is the follow-up open in the
  // editor; `overrides` holds saved-but-not-yet-refetched content so the
  // rail reflects edits immediately (the parent keeps a stale snapshot).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [overrides, setOverrides] = useState<
    Record<string, { subject: string; body: string }>
  >({});

  const displayedSubject = (f: Client["followUpEmails"][number]) =>
    overrides[f.id]?.subject ??
    f.finalSubject ??
    f.editedSubject ??
    f.subject;
  const displayedBody = (f: Client["followUpEmails"][number]) =>
    overrides[f.id]?.body ?? f.finalBody ?? f.editedBody ?? f.body;

  const startEditing = (f: Client["followUpEmails"][number]) => {
    setEditingId(f.id);
    setDraftSubject(displayedSubject(f));
    setDraftBody(displayedBody(f));
  };
  const cancelEditing = () => {
    setEditingId(null);
    setDraftSubject("");
    setDraftBody("");
  };

  const saveFollowUpMutation = useMutation({
    mutationFn: async ({
      id,
      subject,
      body,
    }: {
      id: string;
      subject: string;
      body: string;
    }) => {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedSubject: subject, editedBody: body }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      // Keep the rail open; reflect the edit locally and refresh lists
      // in the background.
      setOverrides((prev) => ({
        ...prev,
        [vars.id]: { subject: vars.subject, body: vars.body },
      }));
      cancelEditing();
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["followups"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { clientStatus?: string; clientNote?: string }) => {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onUpdated();
    },
  });

  const sendFollowUpMutation = useMutation({
    mutationFn: async ({
      id: followUpId,
      subject,
      body,
      channel,
    }: {
      id: string;
      subject?: string;
      body?: string;
      channel?: "email" | "linkedin";
    }) => {
      const isLinkedIn = channel === "linkedin";
      const recipientEmail = client.targetContactEmail || "";
      if (!isLinkedIn && !recipientEmail) throw new Error("No recipient email on file");
      if (isLinkedIn && !client.targetContactLinkedinUrl) {
        throw new Error("No LinkedIn URL on file for this contact");
      }

      // First approve, then send. Mirrors initial email path. Any saved
      // edit is sent alongside the approve so the latest copy goes out.
      const approveRes = await fetch(`/api/followups/${followUpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approve: true,
          ...(subject !== undefined ? { editedSubject: subject } : {}),
          ...(body !== undefined ? { editedBody: body } : {}),
        }),
      });
      if (!approveRes.ok) throw new Error("Approve failed");

      if (isLinkedIn) {
        if (client.targetContactLinkedinUrl) {
          window.open(client.targetContactLinkedinUrl, "_blank", "noopener,noreferrer");
        }
        const markRes = await fetch(`/api/followups/${followUpId}/mark-sent`, {
          method: "POST",
        });
        if (!markRes.ok) {
          const e = await markRes.json().catch(() => ({}));
          throw new Error(e.error || "Mark sent failed");
        }
        return markRes.json();
      }

      const sendRes = await fetch(`/api/followups/${followUpId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail }),
      });
      if (!sendRes.ok) {
        const e = await sendRes.json();
        throw new Error(e.error || "Send failed");
      }
      return sendRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      onUpdated();
    },
  });

  const discardFollowUpMutation = useMutation({
    mutationFn: async (followUpId: string) => {
      const res = await fetch(`/api/followups/${followUpId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onUpdated();
    },
  });

  const handleStatusChange = (status: string) => {
    setPendingStatus(status);
    updateMutation.mutate({ clientStatus: status });
  };

  const handleSaveNote = () => {
    updateMutation.mutate({ clientNote: note });
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="ml-auto h-full w-full max-w-[640px] bg-[var(--color-canvas)] border-l border-[var(--color-line)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[var(--color-canvas)] border-b border-[var(--color-line)] px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
              Client
            </div>
            <h2 className="text-[18px] font-medium leading-tight tracking-tight text-[var(--color-fg)]">
              {client.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-6 space-y-8">
          {/* Identity */}
          <section>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-2">
              Contact
            </div>
            <div className="text-[14px] text-[var(--color-fg)]">
              {client.targetContactFirstName} {client.targetContactLastName || ""}
              {client.targetContactTitle && ` · ${client.targetContactTitle}`}
            </div>
            <div className="font-mono text-[12px] text-[var(--color-fg-muted)] mt-1">
              {client.targetContactEmail || "no email on file"}
            </div>
            {client.website && (
              <div className="font-mono text-[12px] text-[var(--color-fg-muted)] mt-1">
                {client.website}
              </div>
            )}
          </section>

          {/* Status changer */}
          <section>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-3">
              Status
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleStatusChange(s.id)}
                  disabled={updateMutation.isPending}
                  className={cn(
                    "px-2.5 py-1 border text-[12px] transition-colors",
                    client.clientStatus === s.id
                      ? "border-[var(--color-accent)] bg-[var(--color-panel)] text-[var(--color-fg)]"
                      : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-line-strong)]"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="font-mono text-[10.5px] text-[var(--color-fg-subtle)] mt-3">
              Setting any status other than “Awaiting reply” stops the follow-up sequence.
            </p>
          </section>

          {/* Initial outreach */}
          {client.email && (
            <section>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-2 flex items-center gap-2">
                {(client.email.channel || "email") === "linkedin"
                  ? "Initial LinkedIn message"
                  : "Initial email"}
                {client.email.sentAt
                  ? ` · sent ${new Date(client.email.sentAt).toLocaleDateString()}`
                  : ""}
                {(client.email.channel || "email") === "linkedin" && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10">
                    <Linkedin className="h-2.5 w-2.5" />
                    LI
                  </span>
                )}
              </div>
              {(client.email.channel || "email") !== "linkedin" &&
                (client.email.finalSubject || client.email.subject) && (
                  <div className="text-[14px] font-medium text-[var(--color-fg)] mb-2">
                    {client.email.finalSubject || client.email.subject}
                  </div>
                )}
              <pre className="font-mono text-[12px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
                {client.email.finalBody || client.email.body}
              </pre>
            </section>
          )}

          {/* Follow-ups */}
          <section>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-2">
              Follow-ups · {client.followUpEmails.length}/3
            </div>
            {client.followUpEmails.length === 0 ? (
              <p className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                No follow-ups yet. Click “Run follow-ups now” at the top of the page
                {client.nextFollowUpAt
                  ? ` after ${formatRel(new Date(client.nextFollowUpAt))}.`
                  : "."}
              </p>
            ) : (
              <div className="space-y-4">
                {client.followUpEmails.map((f) => {
                  const isEditing = editingId === f.id;
                  const isSaving =
                    saveFollowUpMutation.isPending &&
                    saveFollowUpMutation.variables?.id === f.id;
                  return (
                  <div
                    key={f.id}
                    className="border border-[var(--color-line)] px-4 py-3 bg-[var(--color-panel)]/30"
                  >
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-accent)]">
                        Step {f.step}
                        {f.sentAt
                          ? " · sent"
                          : f.approvedAt
                          ? " · approved"
                          : " · pending review"}
                        {!f.sentAt && overrides[f.id] && " · edited"}
                      </span>
                      {!f.sentAt &&
                        (isEditing ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={isSaving}
                              className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                saveFollowUpMutation.mutate({
                                  id: f.id,
                                  subject: draftSubject,
                                  body: draftBody,
                                })
                              }
                              disabled={isSaving || !draftSubject.trim()}
                              className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-accent)] hover:underline"
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <button
                              type="button"
                              onClick={() => startEditing(f)}
                              disabled={
                                editingId !== null ||
                                sendFollowUpMutation.isPending
                              }
                              className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] inline-flex items-center gap-1 disabled:opacity-40"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                discardFollowUpMutation.mutate(f.id)
                              }
                              disabled={
                                discardFollowUpMutation.isPending ||
                                editingId !== null
                              }
                              className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-status-error)] disabled:opacity-40"
                            >
                              Discard
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                sendFollowUpMutation.mutate({
                                  id: f.id,
                                  subject: overrides[f.id]?.subject,
                                  body: overrides[f.id]?.body,
                                  channel:
                                    (f.channel || "email") === "linkedin"
                                      ? "linkedin"
                                      : "email",
                                })
                              }
                              disabled={
                                sendFollowUpMutation.isPending ||
                                editingId !== null ||
                                ((f.channel || "email") === "linkedin"
                                  ? !client.targetContactLinkedinUrl
                                  : !client.targetContactEmail)
                              }
                              className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-accent)] hover:underline disabled:opacity-40"
                            >
                              {sendFollowUpMutation.isPending
                                ? "Sending..."
                                : (f.channel || "email") === "linkedin"
                                ? "Open LinkedIn & mark sent"
                                : "Approve + send"}
                            </button>
                          </div>
                        ))}
                    </div>
                    {isEditing ? (
                      <div className="space-y-2 mt-2">
                        <Input
                          value={draftSubject}
                          onChange={(e) => setDraftSubject(e.target.value)}
                          placeholder="Subject"
                          className="font-mono text-[12px]"
                        />
                        <Textarea
                          value={draftBody}
                          onChange={(e) => setDraftBody(e.target.value)}
                          rows={10}
                          placeholder="Body"
                          className="font-mono text-[11.5px] leading-relaxed"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-[13px] font-medium text-[var(--color-fg)] mb-1">
                          {displayedSubject(f)}
                        </div>
                        <pre className="font-mono text-[11.5px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
                          {displayedBody(f)}
                        </pre>
                      </>
                    )}
                    {f.sendError && (
                      <p className="mt-2 text-[11px] text-[var(--color-status-error)]">
                        Send error: {f.sendError}
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Notes */}
          <section>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-2">
              Notes
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              placeholder="Discovery call notes, follow-up context, anything that should stay with this client."
              className="font-mono text-[12px]"
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveNote}
                disabled={updateMutation.isPending || note === (client.clientNote || "")}
              >
                Save note
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AddClientDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    domain: "",
    website: "",
    contactFirstName: "",
    contactLastName: "",
    contactEmail: "",
    contactTitle: "",
    clientStatus: "in_progress",
    clientNote: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setForm({
        name: "",
        domain: "",
        website: "",
        contactFirstName: "",
        contactLastName: "",
        contactEmail: "",
        contactTitle: "",
        clientStatus: "in_progress",
        clientNote: "",
      });
      onAdded();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add client manually</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-[var(--color-fg-muted)] -mt-2 mb-2">
          For clients you found outside Apollo. Skips the cold-email pipeline.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ac-name">Company name *</Label>
              <Input
                id="ac-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Acme Inc."
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-website">Website</Label>
              <Input
                id="ac-website"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://acme.com"
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-domain">Domain</Label>
              <Input
                id="ac-domain"
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
                placeholder="acme.com"
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-fn">Contact first name</Label>
              <Input
                id="ac-fn"
                value={form.contactFirstName}
                onChange={(e) => set("contactFirstName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-ln">Contact last name</Label>
              <Input
                id="ac-ln"
                value={form.contactLastName}
                onChange={(e) => set("contactLastName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-email">Contact email</Label>
              <Input
                id="ac-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-title">Contact title</Label>
              <Input
                id="ac-title"
                value={form.contactTitle}
                onChange={(e) => set("contactTitle", e.target.value)}
                placeholder="CTO"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ac-status">Status</Label>
              <select
                id="ac-status"
                value={form.clientStatus}
                onChange={(e) => set("clientStatus", e.target.value)}
                className="w-full h-9 px-3 border border-[var(--color-line)] bg-transparent text-[13px] text-[var(--color-fg)]"
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ac-note">Notes</Label>
              <Textarea
                id="ac-note"
                value={form.clientNote}
                onChange={(e) => set("clientNote", e.target.value)}
                rows={3}
                placeholder="How you met them, what they need, any context"
                className="font-mono text-[12px]"
              />
            </div>
          </div>
          {mutation.isError && (
            <p className="text-[12px] text-[var(--color-status-error)]">
              {(mutation.error as Error).message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name.trim() || mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Adding
              </>
            ) : (
              "Add client"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
