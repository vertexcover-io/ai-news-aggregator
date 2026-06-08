import type { HealthCheckCollector } from "../types/collector-health.js";

export const RUN_STATE_TTL_SECONDS = 3600;
export const COST_TRACKING_LAUNCHED_AT = "2026-05-19";
export const ENRICHED_SUMMARY_LAUNCHED_AT = new Date("2026-05-25T00:00:00Z");
export const MARKDOWN_EXCERPT_MAX = 4096;
export const runKey = (runId: string): string => `run:${runId}`;
export const runCancelChannel = (runId: string): string => `run:cancel:${runId}`;
export * from "./ranking-prompt";
export * from "./shortlist-prompt";
export * from "./social-post";
export * from "./sources.js";

export const HEALTH_CHECKABLE_COLLECTORS = [
  "hn",
  "reddit",
  "twitter",
  "blog",
  "web_search",
] as const satisfies readonly HealthCheckCollector[];
export const collectorHealthKey = (c: HealthCheckCollector): string =>
  `collector-health:${c}`;
export const COLLECTOR_HEALTH_QUEUE_NAME = "collector-health";
export const COLLECTOR_HEALTH_SCHEDULER_KEY = "collector-health:default";
export const COLLECTOR_HEALTH_LEAD_MINUTES = 30;

// ── Alerting / incident constants ──────────────────────────────────────────
/** How long (ms) to suppress duplicate Slack alerts for the same fingerprint. */
export const INCIDENT_ALERT_COOLDOWN_MS = 3_600_000; // 1 hour

/** Enrichment failure rate above which a run_degraded warning is captured. */
export const ENRICHMENT_FAILURE_RATE_THRESHOLD = 0.3;

/** Maximum number of undelivered incidents the sweep re-attempts per run. */
export const ALERT_SWEEP_BATCH_SIZE = 50;

/** After this many failed delivery attempts the sweep stops retrying. */
export const ALERT_MAX_DELIVERY_ATTEMPTS = 10;

/** BullMQ queue name for the alert delivery worker (Phase 2). */
export const ALERT_DELIVERY_QUEUE_NAME = "alert-delivery";

/** Interval (ms) at which the api scheduler triggers the delivery sweep. */
export const ALERT_SWEEP_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
