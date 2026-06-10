import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBranding, type TenantBranding } from "../api/tenant-branding";

export function useTenantBranding(): UseQueryResult<TenantBranding> {
  return useQuery<TenantBranding>({
    queryKey: ["tenant", "branding"],
    queryFn: getBranding,
    staleTime: 5 * 60_000,
  });
}
