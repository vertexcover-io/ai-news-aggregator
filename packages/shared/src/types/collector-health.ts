export type HealthCheckCollector = "hn" | "reddit" | "twitter" | "blog" | "web_search";
export type CollectorHealthStatus = "never" | "running" | "healthy" | "failed";
export type CollectorHealthTrigger = "manual" | "scheduled";

export interface CollectorHealthResult {
  collector: HealthCheckCollector;
  status: CollectorHealthStatus;
  trigger: CollectorHealthTrigger | null; // null only for "never"
  checkedAt: string | null; // ISO 8601; null only for "never"
  durationMs: number | null; // null while running / never
  reason: string | null; // concise failure reason; null otherwise
  detail: string | null; // display-only context; never parsed
}

export interface CollectorHealthSnapshot {
  collectors: CollectorHealthResult[]; // always one entry per HEALTH_CHECKABLE_COLLECTORS
}
