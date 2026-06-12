import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AuthMeResponse } from "@newsletter/shared/types/tenant";
import { fetchMe, UnauthenticatedError } from "../api/auth";

/**
 * The authenticated session: `data.user` carries id/email/name/role/tenantId,
 * `data.tenant` the owning tenant (null for super_admin). Errors with
 * UnauthenticatedError when there is no valid session cookie.
 */
export function useSession(): UseQueryResult<AuthMeResponse> {
  return useQuery<AuthMeResponse>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: (failureCount, err) =>
      !(err instanceof UnauthenticatedError) && failureCount < 1,
    staleTime: 60_000,
  });
}
