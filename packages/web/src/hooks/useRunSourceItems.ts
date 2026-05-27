import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RunSourceItemsResponse } from "@newsletter/shared/types";
import { getRunSourceItems } from "../api/runs";

export function useRunSourceItems(
  runId: string,
  sourceKey: string,
  expanded: boolean,
): UseQueryResult<RunSourceItemsResponse> {
  return useQuery<RunSourceItemsResponse>({
    queryKey: ["run-source-items", runId, sourceKey],
    queryFn: () => getRunSourceItems(runId, sourceKey),
    enabled: expanded,
    retry: false,
  });
}
