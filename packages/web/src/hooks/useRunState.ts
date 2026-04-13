import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getRun, type RunStateResponse } from "../api/runs";

export function useRunState(runId: string): UseQueryResult<RunStateResponse | null> {
  return useQuery<RunStateResponse | null>({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
