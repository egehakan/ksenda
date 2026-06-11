"use client";

import { cn } from "@/lib/utils";
import {
  type RecipeLeg,
  legFlag,
  legShort,
  legCountryLabel,
  legIndustryCode,
} from "@/lib/multi-leg";

/**
 * Compact one-line country chips for a multi-leg DAILY recipe — used on recipe
 * cards and calendar cells. Each chip is `<flag> <SHORT> <cap>`, e.g. 🇩🇪 DE 6.
 */
export function MultiLegChips({
  legs,
  className,
  size = "sm",
}: {
  legs: RecipeLeg[];
  className?: string;
  size?: "xs" | "sm";
}) {
  if (!legs.length) return null;
  const pad = size === "xs" ? "px-1 py-[1px] text-[9.5px]" : "px-1.5 py-0.5 text-[11px]";
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {legs.map((leg, i) => (
        <span
          key={`${legShort(leg)}-${i}`}
          title={`${legCountryLabel(leg)} — ${leg.cap}/day`}
          className={cn(
            "inline-flex items-center gap-1 rounded font-mono leading-none",
            "bg-[var(--color-raised)] text-[var(--color-fg)] border border-[var(--color-line-soft)]",
            pad
          )}
        >
          <span aria-hidden className="not-italic">
            {legFlag(leg)}
          </span>
          <span className="font-semibold tracking-wide">{legShort(leg)}</span>
          <span className="tabular-nums text-[var(--color-fg-muted)]">
            {leg.cap}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Per-country breakdown for a multi-leg DAILY recipe — used in the Today card
 * and the day editor. When `date` is given, shows the exact single-industry
 * recipe each country will rotate to on that day (e.g. "→ DE3"), mirroring the
 * server-side rotation so the UI matches the run.
 */
export function MultiLegBreakdown({
  legs,
  date,
  totalCap,
  className,
}: {
  legs: RecipeLeg[];
  date?: string | null;
  totalCap?: number;
  className?: string;
}) {
  if (!legs.length) return null;
  const total =
    typeof totalCap === "number"
      ? totalCap
      : legs.reduce((s, l) => s + (l.cap || 0), 0);
  return (
    <div className={cn("space-y-1.5", className)}>
      {legs.map((leg, i) => {
        const code = date ? legIndustryCode(leg, date) : null;
        return (
          <div
            key={`${legShort(leg)}-${i}`}
            className="flex items-center gap-2.5 rounded-md border border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40 px-2.5 py-1.5"
          >
            <span aria-hidden className="text-base leading-none">
              {legFlag(leg)}
            </span>
            <span className="text-sm font-medium text-[var(--color-fg)] truncate">
              {legCountryLabel(leg)}
            </span>
            {code && (
              <span
                title={`Today rotates to industry recipe ${code}`}
                className="inline-flex items-center rounded px-1 py-0.5 font-mono text-[10px] font-semibold leading-none bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              >
                {code}
              </span>
            )}
            <span className="ml-auto tabular-nums text-sm font-semibold text-[var(--color-fg)]">
              {leg.cap}
              <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-[var(--color-fg-subtle)]">
                /day
              </span>
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between px-2.5 pt-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
          {legs.length} countries · per day
        </span>
        <span className="tabular-nums text-sm font-semibold text-[var(--color-fg)]">
          {total} total
        </span>
      </div>
    </div>
  );
}
