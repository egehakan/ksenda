import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — shadcn-conventional. Rounded-md, subtle hover, clear hierarchy
 * across default / outline / ghost / destructive / link. The previous
 * "mono" small-caps register has been retired in favor of standard
 * sentence-cased labels — far more familiar to users.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-canvas)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-sm hover:bg-[var(--color-accent-hover)]",
        outline:
          "border border-[var(--color-line)] bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-panel)] hover:text-[var(--color-fg)]",
        ghost:
          "bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-panel)]",
        subtle:
          "bg-[var(--color-panel)] text-[var(--color-fg)] hover:bg-[var(--color-raised)]",
        destructive:
          "bg-[var(--color-status-error)] text-white shadow-sm hover:opacity-90",
        link:
          "h-auto px-0 text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
        iconSm: "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
