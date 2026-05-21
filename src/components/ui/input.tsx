import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — shadcn-conventional. Full bordered box, rounded corners, focus
 * ring. Reads as a standard form field, the pattern users see on every
 * SaaS app.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)]",
          "px-3 py-1 text-sm shadow-sm",
          "text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]",
          "transition-colors duration-150",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-fg)]",
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
Input.displayName = "Input";

export { Input };
