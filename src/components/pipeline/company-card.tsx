"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusDot, type DotState } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { Loader2, Linkedin } from "lucide-react";
import { AiStatusBadge, type AiBadgeConfidence } from "@/components/apollo/ai-status-badge";

interface CompanyCardProps {
  company: {
    id: string;
    name: string;
    domain: string;
    website?: string | null;
    industry?: string | null;
    location?: string | null;
    employeeCount?: number | null;
    pipelineState: string;
    targetContactFirstName?: string | null;
    targetContactLastName?: string | null;
    targetContactEmail?: string | null;
    targetContactTitle?: string | null;
    targetContactLinkedinUrl?: string | null;
    notGeneratedReason?: any;
    aiHasAi?: boolean | null;
    aiStatusJson?: string | null;
    aiCheckedAt?: string | null;
    email?: {
      id: string;
      channel?: string | null;
      subject?: string | null;
      body: string;
      editedSubject?: string | null;
      editedBody?: string | null;
      finalSubject?: string | null;
      finalBody?: string | null;
      sentTo?: string | null;
    } | null;
  };
  onFindContact: (companyId: string) => Promise<void>;
  onReview: (companyId: string) => void;
  onApprove: (companyId: string) => Promise<void>;
  onSend: (companyId: string) => void;
  onRetry?: (companyId: string) => Promise<void>;
  onReset?: (companyId: string) => Promise<void>;
  isSelected?: boolean;
  onSelect?: (companyId: string) => void;
}

const stateLabels: Record<string, string> = {
  email_not_generated: "Failed",
  pending_review: "Review",
  approved_to_send: "Approved",
  sent: "Sent",
  pending_generation: "Pending",
};

function parseAiConfidence(aiStatusJson: string | null | undefined): AiBadgeConfidence {
  if (!aiStatusJson) return "unknown";
  try {
    const r = JSON.parse(aiStatusJson) as { confidence?: string };
    if (
      r.confidence === "confirmed_has_ai" ||
      r.confidence === "probably_no_ai" ||
      r.confidence === "definitely_no_ai"
    ) {
      return r.confidence;
    }
  } catch {
    /* fall through */
  }
  return "unknown";
}

function parseAiSummary(aiStatusJson: string | null | undefined): string {
  if (!aiStatusJson) return "";
  try {
    const r = JSON.parse(aiStatusJson) as { summary?: string };
    return typeof r.summary === "string" ? r.summary : "";
  } catch {
    return "";
  }
}

/*
 * `CompanyCard` is now a dense list row, not a card. Same component name
 * preserved so the dashboard's mapping logic doesn't have to change.
 *
 * Row anatomy (left to right):
 *   - selection checkbox (revealed on hover or when selected)
 *   - status dot (pipeline state)
 *   - primary cluster: company name + state-specific subline
 *   - contact email (mono, right-aligned)
 *   - state badge / timestamp slot (mono)
 *   - primary action — always the right next move for this row's state
 *
 * Hovering reveals a secondary action set on the far right when relevant.
 */
export function CompanyCard({
  company,
  onFindContact,
  onReview,
  onApprove,
  onSend,
  onRetry,
  onReset,
  isSelected = false,
  onSelect,
}: CompanyCardProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const hasContact = !!(
    company.targetContactFirstName ||
    company.targetContactEmail ||
    company.targetContactLinkedinUrl
  );
  const contactName = hasContact
    ? [company.targetContactFirstName, company.targetContactLastName]
        .filter(Boolean)
        .join(" ")
        .trim() || company.targetContactFirstName || ""
    : "";

  const dotState = (company.pipelineState as DotState) || "pending_review";
  const stateBadge = stateLabels[company.pipelineState] || company.pipelineState;
  const isLinkedIn = (company.email?.channel || "email") === "linkedin";

  // Subline content. Failed-generation rows surface the error reason on a
  // single line; everything else splits contact name and title onto two
  // truncated lines so the title stays visible even when the name is long
  // (and on narrow columns where a single-line "Name · Title" would clip).
  const failedReason: string | null = (() => {
    if (company.pipelineState !== "email_not_generated") return null;
    if (
      typeof company.notGeneratedReason === "object" &&
      company.notGeneratedReason?.reason
    ) {
      return company.notGeneratedReason.reason as string;
    }
    if (typeof company.notGeneratedReason === "string") {
      return company.notGeneratedReason;
    }
    return "Generation failed";
  })();

  // The contact column: for LinkedIn rows show the profile URL; for email
  // show the address. For sent rows reflect the actual destination.
  const emailDisplay = (() => {
    if (isLinkedIn) {
      if (company.pipelineState === "sent" && company.email?.sentTo) return company.email.sentTo;
      return company.targetContactLinkedinUrl || "";
    }
    if (company.pipelineState === "sent" && company.email?.sentTo) return company.email.sentTo;
    return company.targetContactEmail || "";
  })();

  return (
    <div
      className={cn(
        "group relative grid items-center gap-x-2 sm:gap-x-4",
        // Tracks scale with the visible columns: email is md+, the state
        // badge is lg+. Hidden (display:none) cells are skipped by grid
        // auto-placement, so each breakpoint's template matches its count.
        "grid-cols-[16px_8px_minmax(0,1fr)_auto]",
        "md:grid-cols-[16px_8px_minmax(0,1.4fr)_minmax(0,1fr)_auto]",
        "lg:grid-cols-[16px_8px_minmax(0,1.4fr)_minmax(0,1fr)_72px_minmax(140px,auto)]",
        "px-3 sm:px-5 py-3 border-b border-[var(--color-line)]",
        "transition-colors duration-150",
        "hover:bg-[var(--color-panel)]",
        isSelected && "bg-[var(--color-panel)]"
      )}
    >
      {/* Selection */}
      <div
        className={cn(
          "flex items-center transition-opacity duration-150",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        )}
      >
        {onSelect && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelect(company.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${company.name}`}
          />
        )}
      </div>

      {/* Status dot */}
      <StatusDot state={dotState} />

      {/* Name + subline */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-[14px] leading-tight font-medium text-[var(--color-fg)]">
            {company.name}
          </span>
          {isLinkedIn && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10 shrink-0"
              title="LinkedIn message"
            >
              <Linkedin className="h-2.5 w-2.5" />
              LI
            </span>
          )}
          {typeof company.aiHasAi === "boolean" && (
            <AiStatusBadge
              hasAi={company.aiHasAi}
              confidence={parseAiConfidence(company.aiStatusJson)}
              title={parseAiSummary(company.aiStatusJson) || undefined}
              className="shrink-0"
            />
          )}
        </div>
        {failedReason ? (
          <div className="mt-1 truncate text-[12px] leading-tight text-[var(--color-status-error)]">
            {failedReason}
          </div>
        ) : contactName || company.targetContactTitle ? (
          <>
            {contactName && (
              <div className="mt-1 truncate text-[12px] leading-tight text-[var(--color-fg-muted)]">
                {contactName}
              </div>
            )}
            {company.targetContactTitle && (
              <div
                className={cn(
                  "truncate text-[11.5px] leading-tight text-[var(--color-fg-subtle)]",
                  contactName ? "mt-0.5" : "mt-1"
                )}
              >
                {company.targetContactTitle}
              </div>
            )}
          </>
        ) : (
          <div className="mt-1 truncate text-[12px] leading-tight text-[var(--color-fg-subtle)]">
            No contact yet
          </div>
        )}
      </div>

      {/* Email */}
      <div className="min-w-0 hidden md:block">
        {emailDisplay ? (
          <div className="truncate font-mono text-[12px] text-[var(--color-fg-muted)] tracking-tight">
            {emailDisplay}
          </div>
        ) : (
          <span className="font-mono text-[12px] text-[var(--color-fg-subtle)]">—</span>
        )}
      </div>

      {/* State badge — hidden for pending_review since the Review button already says it */}
      <div className="hidden lg:block text-right">
        {company.pipelineState !== "pending_review" && (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
            {stateBadge}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-end">
        <RowActions
          state={company.pipelineState}
          companyId={company.id}
          hasContact={hasContact}
          busy={busy}
          run={run}
          onReview={onReview}
          onApprove={onApprove}
          onSend={onSend}
          onRetry={onRetry}
          onReset={onReset}
          onFindContact={onFindContact}
          isLinkedIn={isLinkedIn}
        />
      </div>
    </div>
  );
}

interface RowActionsProps {
  state: string;
  companyId: string;
  hasContact: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  onReview: (companyId: string) => void;
  onApprove: (companyId: string) => Promise<void>;
  onSend: (companyId: string) => void;
  onRetry?: (companyId: string) => Promise<void>;
  onReset?: (companyId: string) => Promise<void>;
  onFindContact: (companyId: string) => Promise<void>;
  isLinkedIn?: boolean;
}

function RowAction({
  primary,
  busy,
  onClick,
  children,
  variant = "primary",
}: {
  primary?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "primary" | "subtle" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 px-2.5",
        "font-mono text-[11px] uppercase tracking-[0.08em] leading-none",
        "transition-colors duration-150",
        "focus-visible:outline-none",
        variant === "primary" && primary &&
          "text-[var(--color-accent-fg)] bg-[var(--color-accent)] hover:bg-[oklch(0.64_0.20_305)]",
        variant === "primary" && !primary &&
          "text-[var(--color-fg)] border border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
        variant === "subtle" &&
          "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
        variant === "ghost" &&
          "text-[var(--color-fg-subtle)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-fg)]",
        busy && "opacity-60 cursor-not-allowed"
      )}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}

function RowActions({
  state,
  companyId,
  hasContact,
  busy,
  run,
  onReview,
  onApprove,
  onSend,
  onRetry,
  onReset,
  onFindContact,
  isLinkedIn,
}: RowActionsProps) {
  if (state === "pending_review") {
    return (
      <>
        <RowAction
          variant="primary"
          onClick={() => onReview(companyId)}
        >
          Review →
        </RowAction>
        <RowAction
          variant="primary"
          primary
          busy={busy === "approve"}
          onClick={() => run("approve", () => onApprove(companyId))}
        >
          Approve
        </RowAction>
      </>
    );
  }

  if (state === "approved_to_send") {
    return (
      <>
        <RowAction variant="subtle" onClick={() => onReview(companyId)}>
          Review
        </RowAction>
        <RowAction variant="primary" primary onClick={() => onSend(companyId)}>
          {isLinkedIn ? "Open LinkedIn →" : "Send →"}
        </RowAction>
      </>
    );
  }

  if (state === "email_not_generated") {
    return (
      <>
        {!hasContact && (
          <RowAction
            variant="primary"
            busy={busy === "find"}
            onClick={() => run("find", () => onFindContact(companyId))}
          >
            Find contact
          </RowAction>
        )}
        {hasContact && onRetry && (
          <RowAction
            variant="primary"
            busy={busy === "retry"}
            onClick={() => run("retry", () => onRetry(companyId))}
          >
            Retry
          </RowAction>
        )}
        {onReset && (
          <RowAction
            variant="subtle"
            busy={busy === "reset"}
            onClick={() => run("reset", () => onReset(companyId))}
          >
            Reset
          </RowAction>
        )}
      </>
    );
  }

  if (state === "sent") {
    return (
      <RowAction variant="subtle" onClick={() => onReview(companyId)}>
        Open
      </RowAction>
    );
  }

  return null;
}
