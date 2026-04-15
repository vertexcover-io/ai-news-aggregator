import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RunSummary } from "@newsletter/shared";
import { listRuns } from "../api/runs";

const POLL_INTERVAL_MS = 2000;

export function useRunList(limit?: number): UseQueryResult<RunSummary[]> {
  return useQuery<RunSummary[]>({
    queryKey: ["runs", { limit: limit ?? null }],
    queryFn: () => listRuns(limit),
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some(
        (r) => r.status === "running" || r.status === "cancelling",
      );
      return hasActive ? POLL_INTERVAL_MS : false;
    },
  });
}
