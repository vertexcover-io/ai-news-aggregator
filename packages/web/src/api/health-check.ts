import type { CollectorType, HealthCheckReport } from "@newsletter/shared/types";
import { apiFetchAdmin } from "./client";

export interface HealthCheckJobResponse {
  jobId: string;
}

export async function triggerHealthCheck(
  collectorType: CollectorType,
): Promise<HealthCheckJobResponse> {
  const res = await apiFetchAdmin(`/api/admin/health-check/${collectorType}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Health check failed: ${String(res.status)}`);
  }
  return (await res.json()) as HealthCheckJobResponse;
}

export async function triggerHealthCheckAll(): Promise<HealthCheckJobResponse> {
  const res = await apiFetchAdmin("/api/admin/health-check", {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Health check failed: ${String(res.status)}`);
  }
  return (await res.json()) as HealthCheckJobResponse;
}

export async function fetchHealthCheckStatus(): Promise<(HealthCheckReport & { storedAt?: string }) | null> {
  const res = await apiFetchAdmin("/api/admin/health-check/status");
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as (HealthCheckReport & { storedAt?: string }) | null;
}
