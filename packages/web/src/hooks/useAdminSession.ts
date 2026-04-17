import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AdminMeResponse } from "@newsletter/shared";
import { fetchMe, UnauthenticatedError } from "../api/admin";

export function useAdminSession(): UseQueryResult<AdminMeResponse> {
  return useQuery<AdminMeResponse>({
    queryKey: ["admin", "me"],
    queryFn: fetchMe,
    retry: (failureCount, err) =>
      !(err instanceof UnauthenticatedError) && failureCount < 1,
    staleTime: 60_000,
  });
}
