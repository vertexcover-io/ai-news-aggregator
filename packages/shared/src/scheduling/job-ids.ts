export type PublishChannel = "email-send" | "linkedin-post" | "twitter-post";

export type ScheduledChannel = PublishChannel | "review-warning";

export const PUBLISH_CHANNELS = [
  "email-send",
  "linkedin-post",
  "twitter-post",
] as const satisfies readonly PublishChannel[];

export const SCHEDULED_CHANNELS = [
  ...PUBLISH_CHANNELS,
  "review-warning",
] as const satisfies readonly ScheduledChannel[];

export const PIPELINE_RUN_SCHEDULER_KEY = "pipeline-run:default";
export const LEGACY_DAILY_RUN_SCHEDULER_KEY = "daily-run:default";

export function jobIdFor(channel: ScheduledChannel, runId: string): string {
  return `${channel}:${runId}`;
}
