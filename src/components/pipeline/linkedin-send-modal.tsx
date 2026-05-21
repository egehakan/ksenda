"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Linkedin, Copy, ExternalLink, Check } from "lucide-react";

/**
 * One row in the modal. The caller maps either a pipeline Company.email row
 * or a Clients-page FollowUpEmail row into this shape. The modal does not
 * know which one it is — it just renders + lets the user mark them sent.
 */
export interface LinkedInRowInput {
  /** Stable id used as the key, and as the id to send to the mark-sent
   *  endpoint. For pipeline rows this is the companyId. For follow-up rows
   *  it's the FollowUpEmail.id. */
  id: string;
  /** Display: who the message is for. */
  contactName: string;
  /** Optional secondary line under the name (title / company / step). */
  subline?: string;
  /** Profile URL to open in a new tab. May be null — then we render a
   *  disabled-looking link with a helper hint. */
  linkedinUrl: string | null;
  /** The message body to copy. Resolves final > edited > original at the
   *  caller. */
  message: string;
}

interface LinkedInSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal header: "Send LinkedIn message" / "Send N LinkedIn messages". */
  rows: LinkedInRowInput[];
  /** Subject of the done action: 'pipeline' (Company.email) or 'followup'
   *  (FollowUpEmail). Determines which mark-sent endpoint we hit. */
  source: "pipeline" | "followup";
  /** Optional explicit submit handler. When provided, supersedes the default
   *  endpoint dispatch (used for tests or custom batching). */
  onConfirm?: (ids: string[]) => Promise<void>;
  /** Called after a successful mark-sent so the parent can invalidate
   *  TanStack Query caches + close the modal. */
  onSuccess?: () => void;
}

/**
 * Manual-send modal for LinkedIn channel rows. The user opens each profile,
 * pastes the message, sends it on LinkedIn, then presses Done to flip the
 * row(s) into the Sent state.
 *
 * Visual style mirrors send-confirmation-dialog.tsx so the two modals feel
 * like siblings; the difference is functional, not stylistic.
 */
export function LinkedInSendModal({
  isOpen,
  onClose,
  rows,
  source,
  onConfirm,
  onSuccess,
}: LinkedInSendModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsLoading(false);
      setError(null);
      setCopiedId(null);
    }
  }, [isOpen]);

  const count = rows.length;
  const headerLabel =
    count === 1 ? "Send LinkedIn message" : `Send ${count} LinkedIn messages`;

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    }
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const ids = rows.map((r) => r.id);
      if (onConfirm) {
        await onConfirm(ids);
      } else if (source === "pipeline") {
        const res = await fetch("/api/pipeline/batch-mark-sent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyIds: ids }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to mark messages sent");
        }
      } else {
        const res = await fetch("/api/followups/batch-mark-sent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followUpEmailIds: ids }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to mark messages sent");
        }
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark messages sent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Linkedin className="h-4 w-4 text-[var(--color-accent)]" />
            {headerLabel}
          </DialogTitle>
          <DialogDescription>
            Open each profile, paste the message, and send it from your own
            LinkedIn account. When you&apos;re finished click Done and we&apos;ll
            move {count === 1 ? "it" : "them"} into Sent.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto -mx-6 px-6 py-2 space-y-5">
          {rows.map((row, idx) => {
            const copied = copiedId === row.id;
            return (
              <div
                key={row.id}
                className="border border-[var(--color-line)] bg-[var(--color-panel)]/40 p-4 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                      {count > 1 ? `${idx + 1} / ${count}` : "Recipient"}
                    </div>
                    <div className="mt-0.5 text-[14px] font-medium text-[var(--color-fg)] truncate">
                      {row.contactName}
                    </div>
                    {row.subline && (
                      <div className="text-[12px] text-[var(--color-fg-muted)] truncate">
                        {row.subline}
                      </div>
                    )}
                  </div>
                  {row.linkedinUrl ? (
                    <a
                      href={row.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-accent)] hover:underline"
                    >
                      Open LinkedIn
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-status-error)]">
                      No LinkedIn URL
                    </span>
                  )}
                </div>

                <pre className="whitespace-pre-wrap break-words rounded bg-[var(--color-canvas)] border border-[var(--color-line-soft)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--color-fg)]">
{row.message}
                </pre>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(row.id, row.message)}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy message
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="text-[12px] text-[var(--color-status-error)]">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || count === 0}>
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </>
            ) : count === 1 ? (
              "Done · mark as sent"
            ) : (
              `Done · mark ${count} as sent`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
