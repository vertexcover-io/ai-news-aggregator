export type PublishChannel = "email-send" | "linkedin-post" | "twitter-post";

export type ScheduledChannel = PublishChannel;

export const PUBLISH_CHANNELS = [
  "email-send",
  "linkedin-post",
  "twitter-post",
] as const satisfies readonly PublishChannel[];

export const SCHEDULED_CHANNELS = PUBLISH_CHANNELS;

export const PIPELINE_RUN_SCHEDULER_KEY = "pipeline-run:default";
export const LEGACY_DAILY_RUN_SCHEDULER_KEY = "daily-run:default";
export const EMAIL_SEND_SCHEDULER_KEY = "email-send:default";
export const LINKEDIN_POST_SCHEDULER_KEY = "linkedin-post:default";
export const TWITTER_POST_SCHEDULER_KEY = "twitter-post:default";

export function jobIdFor(channel: ScheduledChannel, runId: string): string {
  return `${channel}:${runId}`;
}
