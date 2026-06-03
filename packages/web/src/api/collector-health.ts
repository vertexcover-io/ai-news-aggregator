import type {
  CollectorHealthSnapshot,
  HealthCheckCollector,
} from "@newsletter/shared/types";
import { apiFetchAdmin } from "./client";

export async function triggerCollectorHealth(
  collector?: HealthCheckCollector,
): Promise<void> {
  const body = collector !== undefined ? { collector } : {};
  const res = await apiFetchAdmin("/api/admin/collector-health/check", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to trigger collector health check");
}

export async function getCollectorHealthSnapshot(): Promise<CollectorHealthSnapshot> {
  const res = await apiFetchAdmin("/api/admin/collector-health");
  if (!res.ok) throw new Error("Failed to fetch collector health snapshot");
  return (await res.json()) as CollectorHealthSnapshot;
}
