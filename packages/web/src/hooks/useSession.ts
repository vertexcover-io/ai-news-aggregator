import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { SessionMeResponse } from "@newsletter/shared";
import { fetchMe, UnauthenticatedError } from "../api/auth";

export interface Session {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
}

export function useSession(): UseQueryResult<Session> {
  return useQuery<Session>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        const data: SessionMeResponse = await fetchMe();
        if (data.authenticated) {
          return {
            authenticated: true,
            userId: data.userId,
            tenantId: data.tenantId,
            role: data.role,
          };
        }
      } catch (err) {
        if (err instanceof UnauthenticatedError) {
          return { authenticated: false };
        }
      }
      return { authenticated: false };
    },
    retry: (failureCount, err) =>
      !(err instanceof UnauthenticatedError) && failureCount < 1,
    staleTime: 60_000,
  });
}
