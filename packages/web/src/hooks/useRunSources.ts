import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RunSourcesResponse } from "@newsletter/shared";
import { getRunSources } from "../api/runs";

export interface UseRunSourcesOptions {
  runId: string | null;
  enabled: boolean;
}

export function useRunSources({
  runId,
  enabled,
}: UseRunSourcesOptions): UseQueryResult<RunSourcesResponse> {
  return useQuery<RunSourcesResponse>({
    queryKey: ["run-sources", runId],
    queryFn: () => {
      if (runId === null) {
        throw new Error("runId is required");
      }
      return getRunSources(runId);
    },
    enabled: enabled && runId !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}
