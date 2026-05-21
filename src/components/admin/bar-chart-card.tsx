"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "./chart-card";

interface BarChartCardProps {
  title: string;
  subtitle?: string;
  data: Array<{ label: string; value: number }>;
  height?: number;
  yUnit?: "percent" | "count";
}

export function BarChartCard({
  title,
  subtitle,
  data,
  height = 240,
  yUnit,
}: BarChartCardProps) {
  const yFormatter =
    yUnit === "percent"
      ? (v: number) => `${v}%`
      : yUnit === "count"
        ? (v: number) => v.toLocaleString()
        : undefined;
  return (
    <ChartCard title={title} subtitle={subtitle} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid
            stroke="var(--color-line-soft)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="var(--color-fg-subtle)"
            tick={{ fontSize: 11, fill: "var(--color-fg-muted)" }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-12}
            textAnchor="end"
            height={50}
          />
          <YAxis
            stroke="var(--color-fg-subtle)"
            tick={{ fontSize: 11, fill: "var(--color-fg-muted)" }}
            tickFormatter={yFormatter}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-raised)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--color-fg)",
            }}
            cursor={{ fill: "var(--color-accent-soft)" }}
          />
          <Bar
            dataKey="value"
            fill="var(--color-accent)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
