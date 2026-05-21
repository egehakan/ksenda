"use client";

import { cn } from "@/lib/utils";
import { Mail, Linkedin } from "lucide-react";

export type ChannelValue = "email" | "linkedin";

interface ChannelToggleProps {
  value: ChannelValue;
  onChange: (next: ChannelValue) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 2-state outreach channel toggle. Email (SMTP-sent) vs LinkedIn (manual
 * send by the user from their own LinkedIn account). Lives at the top of
 * the search pages so the user picks BEFORE generating.
 */
export function ChannelToggle({
  value,
  onChange,
  disabled,
  className,
}: ChannelToggleProps) {
  const OPTIONS: Array<{ value: ChannelValue; label: string; Icon: React.ComponentType<{ className?: string }>; hint: string }> = [
    { value: "email", label: "Email", Icon: Mail, hint: "Generate cold emails. Sent via your SMTP." },
    { value: "linkedin", label: "LinkedIn", Icon: Linkedin, hint: "Generate LinkedIn DMs. You send manually from your account." },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Outreach channel"
      className={cn(
        "inline-flex w-fit max-w-full overflow-hidden rounded-md border border-[var(--color-line)]",
        disabled && "opacity-60",
        className
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
              "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-none transition-colors px-3 py-1.5",
              "border-l border-[var(--color-line)] first:border-l-0",
              isActive
                ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]"
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
