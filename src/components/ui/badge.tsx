import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Badge: tight mono pill with no fill by default. Used as a metadata tag
 * (count, state name) — never as a celebration.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.08em] leading-none border transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-line)] text-[var(--color-fg-muted)] bg-transparent",
        accent:
          "border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent",
        outline:
          "border-[var(--color-line)] text-[var(--color-fg)] bg-transparent",
        secondary:
          "border-transparent text-[var(--color-fg-muted)] bg-[var(--color-panel)]",
        destructive:
          "border-[oklch(0.50_0.14_30)] text-[var(--color-status-error)] bg-transparent",
        success:
          "border-[oklch(0.40_0.10_140)] text-[oklch(0.74_0.13_140)] bg-transparent",
        warning:
          "border-[var(--color-line-strong)] text-[var(--color-fg)] bg-transparent",
        info:
          "border-[var(--color-line)] text-[var(--color-fg-muted)] bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
