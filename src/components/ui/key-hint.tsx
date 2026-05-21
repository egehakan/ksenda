import * as React from "react";
import { cn } from "@/lib/utils";

interface KeyHintProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/*
 * KeyHint — tight monospace key cap. Used in the queue to show the keyboard
 * shortcut tied to the row's primary action, in the command palette hint, and
 * in the `?` overlay.
 */
export function KeyHint({ className, children, ...rest }: KeyHintProps) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center px-[5px]",
        "font-mono text-[10.5px] leading-none",
        "border border-[var(--color-line)] text-[var(--color-fg-muted)]",
        "bg-[var(--color-canvas)]",
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
