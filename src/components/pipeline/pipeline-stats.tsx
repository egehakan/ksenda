"use client";

import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PipelineStatsProps {
  stats: {
    total: number;
    byState: {
      email_not_generated: number;
      pending_review: number;
      approved_to_send: number;
      sent: number;
    };
  };
  onStateClick?: (state: string) => void;
  activeState?: string;
}

/*
 * Pipeline step rail. The four states render as a connected left-to-right
 * flow (Not generated → Pending review → Approved → Sent) separated by
 * directional chevrons, so it reads as sequential stages rather than a row
 * of loose stats. Each step is a button that filters the list below: the
 * active step carries an accent fill + base tick, and a "View" cue surfaces
 * on hover. "Total" is a summary, not a stage, so it sits outside the rail.
 */
const STEPS: Array<{
  key: keyof PipelineStatsProps["stats"]["byState"];
  label: string;
}> = [
  { key: "email_not_generated", label: "Not generated" },
  { key: "pending_review", label: "Pending review" },
  { key: "approved_to_send", label: "Approved" },
  { key: "sent", label: "Sent" },
];

export function PipelineStats({
  stats,
  onStateClick,
  activeState,
}: PipelineStatsProps) {
  const isClickable = !!onStateClick;

  return (
    <div className="border-b border-[var(--color-line)]">
      {/* Summary + affordance row */}
      <div className="flex items-center justify-between gap-4 px-4 sm:px-5 pt-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
            Total
          </span>
          <span className="font-mono text-[15px] tabular-nums text-[var(--color-fg)]">
            {stats.total}
          </span>
        </div>
        <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] sm:inline">
          Click a stage to view its companies
        </span>
      </div>

      {/* Step rail */}
      <nav
        aria-label="Pipeline stages"
        className="flex items-stretch px-2 sm:px-3 pb-3 pt-2"
      >
        {STEPS.map(({ key, label }, idx) => {
          const count = stats.byState[key] || 0;
          const isActive = activeState === key;

          return (
            <Fragment key={key}>
              <button
                type="button"
                onClick={() => onStateClick?.(key)}
                disabled={!isClickable}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${label}: ${count} ${
                  count === 1 ? "company" : "companies"
                }${isActive ? " (now viewing)" : ""}`}
                className={cn(
                  "group relative flex-1 basis-0 min-w-0 rounded-md px-2 sm:px-4 py-3 text-left",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]",
                  isClickable && "cursor-pointer",
                  isActive
                    ? "bg-[var(--color-accent-soft)]"
                    : isClickable && "hover:bg-[var(--color-panel)]"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "truncate font-mono text-[10.5px] uppercase tracking-[0.10em] leading-none",
                      isActive
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-fg-muted)]"
                    )}
                  >
                    {label}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "ml-auto hidden sm:inline whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.10em] leading-none text-[var(--color-accent)]",
                      "transition-opacity duration-150",
                      isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    )}
                  >
                    {isActive ? "Viewing" : "View →"}
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-2.5 font-mono text-[20px] sm:text-[24px] leading-none tabular-nums",
                    count === 0
                      ? "text-[var(--color-fg-subtle)]"
                      : "text-[var(--color-fg)]"
                  )}
                >
                  {count}
                </div>
                {isActive && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-3 bottom-1.5 h-0.5 rounded-full bg-[var(--color-accent)]"
                  />
                )}
              </button>

              {idx < STEPS.length - 1 && (
                <div
                  aria-hidden
                  className="hidden sm:flex shrink-0 items-center px-0.5 text-[var(--color-fg-subtle)]"
                >
                  <ChevronRight className="h-4 w-4" />
                </div>
              )}
            </Fragment>
          );
        })}
      </nav>
    </div>
  );
}
