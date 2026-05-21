/**
 * Date-range helpers shared by admin metric queries. Times are computed
 * server-side so all KPI windows agree (e.g. "last 7d signups" must use the
 * same `now` as "last 7d emails sent" on the same page render).
 */

export type RangeKey = "7d" | "30d" | "90d";

const DAY_MS = 24 * 60 * 60 * 1000;

export function rangeStart(range: RangeKey, now: Date = new Date()): Date {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * DAY_MS);
}

export function last7d(now: Date = new Date()): Date {
  return rangeStart("7d", now);
}

export function last30d(now: Date = new Date()): Date {
  return rangeStart("30d", now);
}

export function last90d(now: Date = new Date()): Date {
  return rangeStart("90d", now);
}

/**
 * Fill missing days in a date-bucketed series so charts don't visually
 * collapse gaps. Input rows are expected to have a `d` field as `YYYY-MM-DD`.
 */
export function fillMissingDays<T extends { d: string }>(
  rows: T[],
  range: RangeKey,
  template: Omit<T, "d">,
  now: Date = new Date()
): T[] {
  const map = new Map(rows.map((r) => [r.d, r]));
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const result: T[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    result.push((map.get(key) ?? { ...template, d: key }) as T);
  }
  return result;
}

export function formatDayLabel(d: string): string {
  // d is "YYYY-MM-DD" — drop year, keep "MMM DD".
  const date = new Date(d + "T00:00:00Z");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
