import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getEvalFixture, type EvalFixtureResponse } from "../api/eval";

export function useEvalFixture(
  id: string,
): UseQueryResult<EvalFixtureResponse> {
  return useQuery<EvalFixtureResponse>({
    queryKey: ["eval", "fixture", id],
    queryFn: () => getEvalFixture(id),
    enabled: id.length > 0,
    refetchOnWindowFocus: false,
  });
}
