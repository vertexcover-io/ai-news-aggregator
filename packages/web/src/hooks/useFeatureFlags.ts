import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { TenantFeatureFlagsWire } from "@newsletter/shared/types/tenant";
import { getFeatureFlags } from "../api/notifications";

/**
 * The tenant's feature flags (Fix #4). Shares the ["feature-flags"] query key
 * with the Settings → Features panel, so toggling a flag there updates every
 * gate (RequireFeature, AnalyticsPage) without a refetch.
 */
export function useFeatureFlags(): UseQueryResult<TenantFeatureFlagsWire> {
  return useQuery({
    queryKey: ["feature-flags"],
    queryFn: getFeatureFlags,
    refetchOnWindowFocus: false,
  });
}
