import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getArchive, type RunStateResponse } from "../api/runs";

export function useArchive(runId: string): UseQueryResult<RunStateResponse | null> {
  return useQuery<RunStateResponse | null>({
    queryKey: ["archive", runId],
    queryFn: () => getArchive(runId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
