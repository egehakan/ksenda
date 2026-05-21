import * as React from "react";
import { cn } from "@/lib/utils";

export type DotState =
  | "pending_generation"
  | "email_not_generated"
  | "pending_review"
  | "approved_to_send"
  | "sent";

interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: DotState;
}

/*
 * Pipeline status as a 6px dot. The state is communicated through the dot's
 * fill, position, and the row's mono label, never through five tints. Only
 * `approved_to_send` borrows the accent — that's the action point in the
 * pipeline where a human said yes.
 */
export function StatusDot({ state, className, ...rest }: StatusDotProps) {
  const cls = (() => {
    switch (state) {
      case "pending_generation":
        return "bg-transparent border border-[var(--color-fg-muted)]";
      case "email_not_generated":
        return "bg-[var(--color-status-error)]";
      case "pending_review":
        return "bg-[var(--color-fg-muted)]";
      case "approved_to_send":
        return "bg-[var(--color-accent)]";
      case "sent":
        return "bg-transparent border border-[var(--color-fg-subtle)]";
    }
  })();

  return (
    <span
      role="presentation"
      className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", cls, className)}
      {...rest}
    />
  );
}
