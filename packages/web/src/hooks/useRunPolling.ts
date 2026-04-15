import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RunStatus } from "@newsletter/shared";
import { getRun, type RunStateResponse } from "../api/runs";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function useRunPolling(
  runId: string | null,
): UseQueryResult<RunStateResponse | null> {
  return useQuery<RunStateResponse | null>({
    queryKey: ["run", runId],
    queryFn: () => {
      if (runId === null) throw new Error("runId is null");
      return getRun(runId);
    },
    enabled: runId !== null,
    refetchInterval: (query) => {
      const { data, dataUpdateCount } = query.state;
      if (dataUpdateCount > 0 && data === null) return false;
      if (data && TERMINAL_STATUSES.has(data.status)) return false;
      return POLL_INTERVAL_MS;
    },
    retry: false,
  });
}
