"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "./chart-card";

interface SeriesConfig {
  key: string;
  label: string;
  color?: string;
}

interface LineChartCardProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  /** "percent" appends "%" to Y-axis ticks; "count" formats with thousands. */
  yUnit?: "percent" | "count";
}

const PALETTE = [
  "var(--color-accent)",
  "var(--color-status-success)",
  "var(--color-fg-muted)",
  "var(--color-status-error)",
];

export function LineChartCard({
  title,
  subtitle,
  actions,
  data,
  xKey,
  series,
  height = 240,
  yUnit,
}: LineChartCardProps) {
  const yFormatter =
    yUnit === "percent"
      ? (v: number) => `${v}%`
      : yUnit === "count"
        ? (v: number) => v.toLocaleString()
        : undefined;
  return (
    <ChartCard title={title} subtitle={subtitle} actions={actions} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        >
          <CartesianGrid
            stroke="var(--color-line-soft)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey={xKey}
            stroke="var(--color-fg-subtle)"
            tick={{ fontSize: 11, fill: "var(--color-fg-muted)" }}
            tickLine={false}
            axisLine={false}
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
            labelStyle={{ color: "var(--color-fg-muted)" }}
            cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color || PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
