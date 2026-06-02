export type CollectorType = "hn" | "reddit" | "twitter" | "web_search" | "blog";

export type HealthCheckStatus = "healthy" | "failed" | "skipped";

export interface HealthCheckResult {
  collector: CollectorType;
  status: HealthCheckStatus;
  durationMs: number;
  itemsFound?: number;
  /** Concise actionable message, only when failed. */
  error?: string;
  /** Only when skipped (e.g., "no sources configured"). */
  reason?: string;
}

export interface HealthCheckReport {
  results: HealthCheckResult[];
  totalDurationMs: number;
  failedCount: number;
  healthyCount: number;
  skippedCount: number;
}

export interface HealthCheckJobData {
  collectorType?: CollectorType; // undefined = check all
  triggeredBy: "manual" | "scheduled";
}
