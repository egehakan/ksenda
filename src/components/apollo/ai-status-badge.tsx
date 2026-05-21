"use client";

import { cn } from "@/lib/utils";
import { Sparkles, CircleSlash, HelpCircle } from "lucide-react";

export type AiBadgeConfidence =
  | "confirmed_has_ai"
  | "probably_no_ai"
  | "definitely_no_ai"
  | "unknown";

interface AiStatusBadgeProps {
  hasAi: boolean;
  confidence: AiBadgeConfidence;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}

/**
 * Tiny pill rendered next to a search row or pipeline card after AI-presence
 * detection has run. Color-coded:
 *   - confirmed_has_ai      → muted/strikethrough (this is a disqualified target)
 *   - probably_no_ai        → amber (proceed with caveat)
 *   - definitely_no_ai      → accent (best-fit target — pitch confidently)
 *   - unknown               → grey
 */
export function AiStatusBadge({
  hasAi,
  confidence,
  size = "sm",
  title,
  className,
}: AiStatusBadgeProps) {
  const isSm = size === "sm";
  const label =
    confidence === "confirmed_has_ai"
      ? "has AI"
      : confidence === "probably_no_ai"
      ? "probably no AI"
      : confidence === "definitely_no_ai"
      ? "no AI"
      : "unknown";

  const Icon =
    confidence === "confirmed_has_ai"
      ? Sparkles
      : confidence === "unknown"
      ? HelpCircle
      : CircleSlash;

  const colorClass =
    confidence === "confirmed_has_ai"
      ? "bg-[var(--color-line-soft)] text-[var(--color-fg-subtle)] border-[var(--color-line)]"
      : confidence === "probably_no_ai"
      ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30"
      : confidence === "definitely_no_ai"
      ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)] border-[var(--color-status-success)]/30"
      : "bg-[var(--color-line-soft)] text-[var(--color-fg-muted)] border-[var(--color-line)]";

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-mono uppercase tracking-[0.05em]",
        isSm ? "text-[9.5px] leading-none px-1.5 py-[3px]" : "text-[10.5px] leading-none px-2 py-1",
        colorClass,
        className
      )}
    >
      <Icon className={cn(isSm ? "h-2.5 w-2.5" : "h-3 w-3")} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
