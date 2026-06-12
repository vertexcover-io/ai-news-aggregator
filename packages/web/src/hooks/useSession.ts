import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  MeResponse,
  SessionTenant,
  SessionUser,
} from "@newsletter/shared/types";
import { fetchMe, UnauthenticatedError } from "../api/auth";

export type UseSessionResult = UseQueryResult<MeResponse> & {
  user: SessionUser | null;
  tenant: SessionTenant | null;
  role: SessionUser["role"] | null;
  impersonating: boolean;
};

export function useSession(): UseSessionResult {
  const query = useQuery<MeResponse>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: (failureCount, err) =>
      !(err instanceof UnauthenticatedError) && failureCount < 1,
    staleTime: 60_000,
  });
  return {
    ...query,
    user: query.data?.user ?? null,
    tenant: query.data?.tenant ?? null,
    role: query.data?.user.role ?? null,
    impersonating: query.data?.impersonating ?? false,
  };
}
