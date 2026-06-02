import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectorType, HealthCheckReport } from "@newsletter/shared/types";
import {
  triggerHealthCheck,
  triggerHealthCheckAll,
  fetchHealthCheckStatus,
  type HealthCheckJobResponse,
} from "../api/health-check";

const STATUS_KEY = ["health-check-status"];

export function useHealthCheckStatus(): {
  report: (HealthCheckReport & { storedAt?: string }) | null | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<(HealthCheckReport & { storedAt?: string }) | null>({
    queryKey: STATUS_KEY,
    queryFn: fetchHealthCheckStatus,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  return { report: data, isLoading, error };
}

export function useTriggerHealthCheck(collectorType?: CollectorType) {
  const queryClient = useQueryClient();
  return useMutation<HealthCheckJobResponse>({
    mutationFn: () =>
      collectorType
        ? triggerHealthCheck(collectorType)
        : triggerHealthCheckAll(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}
