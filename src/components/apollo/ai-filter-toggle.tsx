"use client";

import { cn } from "@/lib/utils";
import { Sparkles, CircleSlash, CircleDot } from "lucide-react";

export type AiFilterValue = "any" | "no_ai" | "has_ai";

interface AiFilterToggleProps {
  value: AiFilterValue;
  onChange: (next: AiFilterValue) => void;
  disabled?: boolean;
  helper?: string;
  className?: string;
  /**
   * 'inline' (default) is for the search bar — flexible horizontal layout
   * that wraps as a unit. 'stacked' is for narrow form columns (recipe
   * builder) — labels collapse to icons only.
   */
  variant?: "inline" | "stacked";
}

const OPTIONS: Array<{
  value: AiFilterValue;
  label: string;
  short: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  {
    value: "any",
    label: "Any",
    short: "Any",
    Icon: CircleDot,
    hint: "Skip detection. Import every match.",
  },
  {
    value: "no_ai",
    label: "No AI",
    short: "No AI",
    Icon: CircleSlash,
    hint: "Page-walk Apollo, run cheap AI detection, import only companies WITHOUT observable AI.",
  },
  {
    value: "has_ai",
    label: "Has AI",
    short: "Has AI",
    Icon: Sparkles,
    hint: "Same flow, but keep only companies that ALREADY use AI.",
  },
];

/**
 * Pre-search 3-state toggle. Triggers the page-walking import flow when set
 * to no_ai or has_ai. Two layout variants:
 *   - inline (search bar): label + icon, flex-wraps as needed
 *   - stacked (form column): each option's label sits next to its icon
 *     with no wrap, segment width fits-content
 */
export function AiFilterToggle({
  value,
  onChange,
  disabled,
  helper,
  className,
  variant = "inline",
}: AiFilterToggleProps) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <div
      className={cn(
        // 'stacked' must be block-level so it drops below the Field label
        // instead of flowing inline beside it; 'inline' stays inline so it
        // wraps as a unit in the search bar.
        variant === "stacked" ? "flex" : "inline-flex",
        "flex-col gap-1.5 max-w-full",
        className
      )}
    >
      <div
        role="radiogroup"
        aria-label="AI presence filter"
        className={cn(
          "inline-flex w-fit max-w-full overflow-hidden rounded-md border border-[var(--color-line)]",
          disabled && "opacity-60"
        )}
      >
        {OPTIONS.map((opt) => {
          const isActive = opt.value === value;
          const Icon = opt.Icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              title={opt.hint}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-none transition-colors",
                "border-l border-[var(--color-line)] first:border-l-0",
                variant === "stacked" ? "px-2.5 py-2" : "px-3 py-1.5",
                isActive
                  ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]"
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span>{opt.short}</span>
            </button>
          );
        })}
      </div>
      <p className="font-mono text-[10.5px] text-[var(--color-fg-subtle)] leading-snug max-w-[30rem]">
        {helper ?? active.hint}
      </p>
    </div>
  );
}
