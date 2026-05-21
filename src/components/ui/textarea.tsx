import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea — shadcn-conventional. Bordered, rounded, with focus ring.
 * Consumers can override with `font-mono` className when displaying code
 * or signature HTML.
 */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)]",
          "px-3 py-2 text-sm shadow-sm",
          "text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-canvas)] focus-visible:border-[var(--color-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
