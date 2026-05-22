import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  listEvalFixtures,
  type FixtureSummary,
} from "../api/eval";

export interface EvalFixturesResponse {
  fixtures: FixtureSummary[];
}

export function useEvalFixtures(): UseQueryResult<EvalFixturesResponse> {
  return useQuery<EvalFixturesResponse>({
    queryKey: ["eval", "fixtures"],
    queryFn: listEvalFixtures,
    refetchOnWindowFocus: false,
  });
}
