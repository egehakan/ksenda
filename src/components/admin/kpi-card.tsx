import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  delta?: { value: number; label?: string };
  accent?: boolean;
  className?: string;
}

/**
 * Compact stat tile. Label on top in mono small-caps eyebrow style; large
 * value beneath using tabular-nums. Optional delta chip uses status colors.
 * `accent` lifts the surface and tints the value text — used sparingly for
 * the headline metric on each page.
 */
export function KpiCard({
  label,
  value,
  hint,
  delta,
  accent,
  className,
}: KpiCardProps) {
  const formatted = typeof value === "number" ? formatNumber(value) : value;
  const deltaColor =
    delta == null
      ? undefined
      : delta.value > 0
        ? "text-[var(--color-status-success)]"
        : delta.value < 0
          ? "text-[var(--color-status-error)]"
          : "text-[var(--color-fg-subtle)]";

  return (
    <div
      className={cn(
        "rounded-lg border p-5 flex flex-col gap-2",
        "border-[var(--color-line-soft)]",
        accent
          ? "bg-[var(--color-raised)]"
          : "bg-[var(--color-panel)]",
        className
      )}
    >
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "text-[28px] leading-none font-semibold tabular-nums",
          accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
        )}
      >
        {formatted}
      </div>
      <div className="flex items-center gap-2 min-h-[18px]">
        {delta != null && (
          <span
            className={cn(
              "font-mono text-[11px] tabular-nums tracking-tight",
              deltaColor
            )}
          >
            {delta.value > 0 ? "+" : ""}
            {delta.value}
            {delta.label ? ` ${delta.label}` : "%"}
          </span>
        )}
        {hint && (
          <span className="text-[12px] text-[var(--color-fg-subtle)]">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (Math.abs(n) >= 10_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return n.toLocaleString("en-US");
}
