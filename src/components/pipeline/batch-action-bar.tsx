"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BatchActionBarProps {
  selectedCount: number;
  totalCount: number;
  pipelineState: string | null;
  onApprove?: () => void;
  onDelete?: () => void;
  onSend?: () => void;
  onRetry?: () => void;
  onClear: () => void;
  isLoading?: {
    approve?: boolean;
    delete?: boolean;
    send?: boolean;
    retry?: boolean;
  };
  /** Override the Send button label (e.g. "Open LinkedIn 3"). */
  sendLabel?: string;
  /** Disable Send with a tooltip — used for mixed email + LinkedIn selections. */
  sendDisabled?: boolean;
  sendDisabledReason?: string;
}

/*
 * Selection bar. Pinned to the bottom edge, full width, hairline above. No
 * floating card, no shadow, no slide-in-from-bottom animation. Sits flat
 * against the bottom rule.
 */
export function BatchActionBar({
  selectedCount,
  totalCount,
  pipelineState,
  onApprove,
  onDelete,
  onSend,
  onRetry,
  onClear,
  isLoading = {},
  sendLabel,
  sendDisabled,
  sendDisabledReason,
}: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  const isAnyLoading = Object.values(isLoading).some(Boolean);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40",
        "border-t border-[var(--color-line-strong)]",
        "bg-[var(--color-canvas)]/95 backdrop-blur-sm",
        "transition-opacity duration-150"
      )}
    >
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-5">
        <span className="font-mono text-[12px] text-[var(--color-fg)] tabular-nums">
          {selectedCount}
          <span className="text-[var(--color-fg-subtle)]"> / {totalCount}</span>
          <span className="ml-2 uppercase tracking-[0.08em] text-[10.5px] text-[var(--color-fg-muted)]">
            selected
          </span>
        </span>

        <div className="h-5 w-px bg-[var(--color-line)]" aria-hidden />

        <div className="flex items-center gap-2 flex-1">
          {pipelineState === "pending_review" && (
            <>
              {onApprove && (
                <Button size="sm" onClick={onApprove} disabled={isAnyLoading}>
                  {isLoading.approve && <Loader2 className="h-3 w-3 animate-spin" />}
                  Approve {selectedCount}
                </Button>
              )}
              {onDelete && (
                <Button size="sm" variant="destructive" onClick={onDelete} disabled={isAnyLoading}>
                  {isLoading.delete && <Loader2 className="h-3 w-3 animate-spin" />}
                  Delete {selectedCount}
                </Button>
              )}
            </>
          )}

          {pipelineState === "email_not_generated" && (
            <>
              {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry} disabled={isAnyLoading}>
                  {isLoading.retry && <Loader2 className="h-3 w-3 animate-spin" />}
                  Retry {selectedCount}
                </Button>
              )}
              {onDelete && (
                <Button size="sm" variant="destructive" onClick={onDelete} disabled={isAnyLoading}>
                  {isLoading.delete && <Loader2 className="h-3 w-3 animate-spin" />}
                  Delete {selectedCount}
                </Button>
              )}
            </>
          )}

          {pipelineState === "approved_to_send" && (
            <>
              {onSend && (
                <Button
                  size="sm"
                  onClick={onSend}
                  disabled={isAnyLoading || sendDisabled}
                  title={sendDisabled && sendDisabledReason ? sendDisabledReason : undefined}
                >
                  {isLoading.send && <Loader2 className="h-3 w-3 animate-spin" />}
                  {sendLabel ?? `Send ${selectedCount}`}
                </Button>
              )}
              {sendDisabled && sendDisabledReason && (
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-status-error)]">
                  {sendDisabledReason}
                </span>
              )}
              {onDelete && (
                <Button size="sm" variant="destructive" onClick={onDelete} disabled={isAnyLoading}>
                  {isLoading.delete && <Loader2 className="h-3 w-3 animate-spin" />}
                  Delete {selectedCount}
                </Button>
              )}
            </>
          )}

          {pipelineState === "sent" && onDelete && (
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={isAnyLoading}>
              {isLoading.delete && <Loader2 className="h-3 w-3 animate-spin" />}
              Delete {selectedCount}
            </Button>
          )}
        </div>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={isAnyLoading}>
          Clear
        </Button>
      </div>
    </div>
  );
}
