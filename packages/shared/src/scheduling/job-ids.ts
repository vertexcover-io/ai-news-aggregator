export type PublishChannel = "email-send" | "linkedin-post" | "twitter-post";

export type ScheduledChannel = PublishChannel;

export const PUBLISH_CHANNELS = [
  "email-send",
  "linkedin-post",
  "twitter-post",
] as const satisfies readonly PublishChannel[];

export const SCHEDULED_CHANNELS = PUBLISH_CHANNELS;

export type SchedulerKind =
  | "pipeline-run"
  | "email-send"
  | "linkedin-post"
  | "twitter-post"
  | "collector-health"
  | "social-health";

// Scheduler KEYS may contain ":" — BullMQ generates the underlying job ids
// itself (repeat:<key>:<ts>), so the custom-job-id colon restriction (D-112)
// does not apply here. See jobIdFor below for custom job ids.
export function schedulerKeyFor(kind: SchedulerKind, tenantId: string): string {
  return `${kind}:${tenantId}`;
}

// Pre-multi-tenancy global scheduler keys (one fixed entry per kind). Removed
// once at API boot; per-tenant keys from schedulerKeyFor replace them. Jobs
// already enqueued by these schedulers carry no tenantId and resolve to
// tenant 0 at the worker boundary (jobTenantId), so removal is safe mid-flight.
export const LEGACY_PROCESSING_SCHEDULER_KEYS = [
  "pipeline-run:default",
  "daily-run:default",
  "email-send:default",
  "linkedin-post:default",
  "twitter-post:default",
  "social-health:default",
] as const;

export const LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY = "collector-health:default";

// Custom BullMQ job ids must not contain ":" — bullmq >=5.x validateOptions rejects it
// (colon is the Redis key delimiter). Scheduler keys above are exempt: BullMQ generates
// their job ids internally (repeat:<key>:<ts>).
export function jobIdFor(channel: ScheduledChannel, runId: string): string {
  return `${channel}-${runId}`;
}
