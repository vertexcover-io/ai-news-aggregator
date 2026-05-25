import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RunObservability, RunStatus } from "@newsletter/shared/types";
import { getRunObservability } from "../api/runs";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function useRunObservability(
  runId: string | null,
): UseQueryResult<RunObservability | null> {
  return useQuery<RunObservability | null>({
    queryKey: ["run-observability", runId],
    queryFn: () => {
      if (runId === null) throw new Error("runId is null");
      return getRunObservability(runId);
    },
    enabled: runId !== null,
    refetchInterval: (query) => {
      const { data, dataUpdateCount } = query.state;
      if (dataUpdateCount > 0 && data === null) return false;
      if (data && TERMINAL_STATUSES.has(data.run.status)) return false;
      return POLL_INTERVAL_MS;
    },
    retry: false,
  });
}
