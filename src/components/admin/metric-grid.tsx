import { cn } from "@/lib/utils";

interface MetricGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

const COLS: Record<NonNullable<MetricGridProps["columns"]>, string> = {
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 md:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
};

export function MetricGrid({
  children,
  columns = 4,
  className,
}: MetricGridProps) {
  return (
    <div className={cn("grid gap-3", COLS[columns], className)}>{children}</div>
  );
}
