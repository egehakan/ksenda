"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartCard } from "./chart-card";

interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartCardProps {
  title: string;
  subtitle?: string;
  data: DonutDatum[];
  height?: number;
}

const DEFAULT_COLORS = [
  "var(--color-accent)",
  "var(--color-status-success)",
  "var(--color-status-error)",
  "var(--color-fg-muted)",
  "var(--color-status-pending)",
  "var(--color-line-strong)",
];

export function DonutChartCard({
  title,
  subtitle,
  data,
  height = 240,
}: DonutChartCardProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ChartCard title={title} subtitle={subtitle} height={height}>
      <div className="flex h-full items-center gap-4">
        <div className="w-1/2 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="60%"
                outerRadius="90%"
                stroke="var(--color-panel)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {data.map((d, i) => (
                  <Cell
                    key={d.label}
                    fill={d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--color-raised)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--color-fg)",
                }}
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  const display = Number.isFinite(n)
                    ? `${n.toLocaleString()} (${total ? Math.round((n / total) * 100) : 0}%)`
                    : String(value);
                  return [display, name as string];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="w-1/2 space-y-1.5 pr-4 text-[12px]">
          {data.map((d, i) => (
            <div key={d.label} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{
                  background:
                    d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                }}
              />
              <span className="flex-1 truncate text-[var(--color-fg-muted)]">
                {d.label}
              </span>
              <span className="font-mono tabular-nums text-[var(--color-fg)]">
                {d.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
