import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getNotifications, getFeatures, type NotificationsConfig, type FeatureFlags } from "../api/tenant-settings";

export function useNotifications(): UseQueryResult<NotificationsConfig> {
  return useQuery<NotificationsConfig>({
    queryKey: ["settings", "notifications"],
    queryFn: getNotifications,
    refetchOnWindowFocus: false,
  });
}

export function useFeatures(): UseQueryResult<FeatureFlags> {
  return useQuery<FeatureFlags>({
    queryKey: ["settings", "features"],
    queryFn: getFeatures,
    refetchOnWindowFocus: false,
  });
}
