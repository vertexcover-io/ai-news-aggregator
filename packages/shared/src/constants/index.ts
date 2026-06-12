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
export * from "./tenant.js";

export const HEALTH_CHECKABLE_COLLECTORS = [
  "hn",
  "reddit",
  "twitter",
  "blog",
  "web_search",
] as const satisfies readonly HealthCheckCollector[];
export const collectorHealthKey = (
  tenantId: string,
  c: HealthCheckCollector,
): string => `collector-health:${tenantId}:${c}`;
export const COLLECTOR_HEALTH_QUEUE_NAME = "collector-health";
export const COLLECTOR_HEALTH_LEAD_MINUTES = 30;
