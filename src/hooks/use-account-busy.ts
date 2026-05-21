"use client";

import { useQuery } from "@tanstack/react-query";

interface ActiveJob {
  id: string;
  kind: string;
  status: string;
  currentLabel: string | null;
}

/**
 * Account-wide "is a job in flight" signal for disabling Run today /
 * Search people / Search company. Shares the `["jobs-active"]` React
 * Query cache with the global JobProgressWidget (same key + queryFn +
 * dynamic poll interval), so this adds no extra polling — it just derives
 * `busy` from whether any GenerationJob is `running`.
 *
 * This is the UI half of the lock; the authoritative guard is the 409
 * those three routes return via `getActiveBlockingJob`.
 */
export function useAccountBusy() {
  const { data } = useQuery({
    queryKey: ["jobs-active"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/active");
      if (!res.ok) return { jobs: [] as ActiveJob[] };
      return res.json() as Promise<{ jobs: ActiveJob[] }>;
    },
    refetchInterval: (query) => {
      const jobs =
        (query.state.data as { jobs?: ActiveJob[] } | undefined)?.jobs ?? [];
      return jobs.some((j) => j.status === "running") ? 2_000 : 8_000;
    },
    staleTime: 1_000,
  });

  const running = (data?.jobs ?? []).find((j) => j.status === "running");
  return {
    busy: !!running,
    label: running?.currentLabel ?? null,
    kind: running?.kind ?? null,
  };
}
