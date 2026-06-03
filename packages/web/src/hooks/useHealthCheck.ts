import { useMutation } from "@tanstack/react-query";
import type { CollectorType } from "@newsletter/shared/types";
import {
  triggerHealthCheck,
  type HealthCheckJobResponse,
} from "../api/health-check";

export function useHealthCheck(
  collectorType: CollectorType,
) {
  return useMutation<HealthCheckJobResponse>({
    mutationFn: () => triggerHealthCheck(collectorType),
  });
}
