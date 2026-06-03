import type { Queue } from "bullmq";
import {
  EMAIL_SEND_SCHEDULER_KEY,
  LEGACY_DAILY_RUN_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  TWITTER_POST_SCHEDULER_KEY,
  type UserSettings,
} from "@newsletter/shared";

export const SOCIAL_HEALTH_SCHEDULER_KEY = "social-health:default";
const SOCIAL_HEALTH_LEAD_MINUTES = 15;
const PUBLISH_SCHEDULERS = [
  {
    key: EMAIL_SEND_SCHEDULER_KEY,
    jobName: "email-send",
    enabled: (settings: UserSettings) => settings.emailEnabled,
    time: (settings: UserSettings) => settings.emailTime,
  },
  {
    key: LINKEDIN_POST_SCHEDULER_KEY,
    jobName: "linkedin-post",
    enabled: (settings: UserSettings) => settings.linkedinEnabled,
    time: (settings: UserSettings) => settings.linkedinTime,
  },
  {
    key: TWITTER_POST_SCHEDULER_KEY,
    jobName: "twitter-post",
    enabled: (settings: UserSettings) => settings.twitterPostEnabled,
    time: (settings: UserSettings) => settings.twitterTime,
  },
] as const;

export function toCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return `${m} ${h} * * *`;
}

export function toCronMinusMinutes(hhmm: string, minutesBefore: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  const dayMinutes = 24 * 60;
  const total = (h * 60 + m - minutesBefore + dayMinutes) % dayMinutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${minute} ${hour} * * *`;
}

export async function reconcilePipelineSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
): Promise<void> {
  const pipelineTime = settings.pipelineTime;
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(PIPELINE_RUN_SCHEDULER_KEY);
    await queue.removeJobScheduler(SOCIAL_HEALTH_SCHEDULER_KEY);
    for (const scheduler of PUBLISH_SCHEDULERS) {
      await queue.removeJobScheduler(scheduler.key);
    }
    return;
  }
  await queue.upsertJobScheduler(
    PIPELINE_RUN_SCHEDULER_KEY,
    { pattern: toCron(pipelineTime), tz: settings.scheduleTimezone },
    { name: "pipeline-run", data: {} },
  );
  await queue.upsertJobScheduler(
    SOCIAL_HEALTH_SCHEDULER_KEY,
    {
      pattern: toCronMinusMinutes(
        pipelineTime,
        SOCIAL_HEALTH_LEAD_MINUTES,
      ),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: {} },
  );
  for (const scheduler of PUBLISH_SCHEDULERS) {
    if (!scheduler.enabled(settings)) {
      await queue.removeJobScheduler(scheduler.key);
      continue;
    }
    await queue.upsertJobScheduler(
      scheduler.key,
      { pattern: toCron(scheduler.time(settings)), tz: settings.scheduleTimezone },
      { name: scheduler.jobName, data: {} },
    );
  }
}

export async function removeLegacySchedulers(
  queue: Pick<Queue, "removeJobScheduler">,
): Promise<void> {
  await queue.removeJobScheduler(LEGACY_DAILY_RUN_SCHEDULER_KEY);
}

export {
  EMAIL_SEND_SCHEDULER_KEY,
  LEGACY_DAILY_RUN_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  TWITTER_POST_SCHEDULER_KEY,
};

export const DAILY_RUN_SCHEDULER_KEY = LEGACY_DAILY_RUN_SCHEDULER_KEY;

type LegacyScheduleSettings = Omit<UserSettings, "pipelineTime" | "scheduleTime"> & {
  readonly pipelineTime?: string;
  readonly scheduleTime?: string;
};

export async function reconcileDailyRunSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: LegacyScheduleSettings,
): Promise<void> {
  const scheduleTime = settings.pipelineTime ?? settings.scheduleTime;
  if (scheduleTime === undefined) {
    throw new Error("pipelineTime or scheduleTime is required");
  }
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(DAILY_RUN_SCHEDULER_KEY);
    await queue.removeJobScheduler(SOCIAL_HEALTH_SCHEDULER_KEY);
    return;
  }
  await queue.upsertJobScheduler(
    DAILY_RUN_SCHEDULER_KEY,
    { pattern: toCron(scheduleTime), tz: settings.scheduleTimezone },
    { name: "daily-run", data: {} },
  );
  await queue.upsertJobScheduler(
    SOCIAL_HEALTH_SCHEDULER_KEY,
    {
      pattern: toCronMinusMinutes(scheduleTime, SOCIAL_HEALTH_LEAD_MINUTES),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: {} },
  );
}
