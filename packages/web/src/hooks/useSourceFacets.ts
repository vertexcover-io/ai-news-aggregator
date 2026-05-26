import { useQuery } from "@tanstack/react-query";
import { getSourceFacets } from "../api/archives";

export interface SourceFacetEntry {
  sourceIdentifier: string;
  displayName: string;
  count: number;
}

export interface SourceFacetGroup {
  sourceType: string;
  facets: SourceFacetEntry[];
}

export interface UseSourceFacetsResult {
  facets: SourceFacetGroup[];
  isLoading: boolean;
}

export function useSourceFacets(runId: string): UseSourceFacetsResult {
  const query = useQuery({
    queryKey: ["source-facets", runId],
    queryFn: () => getSourceFacets(runId),
    enabled: Boolean(runId),
    refetchOnWindowFocus: false,
  });

  return {
    facets: query.data ?? [],
    isLoading: query.isLoading,
  };
}
