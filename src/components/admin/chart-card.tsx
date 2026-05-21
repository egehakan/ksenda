import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  height?: number;
}

/**
 * Shell for chart components. Use as the wrapper around any Recharts content
 * so cards stay visually aligned (title row, body padding, fixed body height).
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  height = 240,
}: ChartCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--color-panel)] border-[var(--color-line-soft)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight text-[var(--color-fg)]">
            {title}
          </div>
          {subtitle && (
            <div className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {actions}
      </div>
      <div className="px-2 pb-3" style={{ height }}>
        {children}
      </div>
    </div>
  );
}
