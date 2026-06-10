import type { Queue } from "bullmq";
import {
  AGENTLOOP_TENANT_ID,
  COLLECTOR_HEALTH_LEAD_MINUTES,
  COLLECTOR_HEALTH_SCHEDULER_KEY,
  EMAIL_SEND_SCHEDULER_KEY,
  LEGACY_DAILY_RUN_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  schedulerKey,
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

// Start-time jitter (F46/NF4): tenants sharing a nominal pipeline time are spread
// across a jitter window so they don't all fire at once (thundering herd). The
// offset is a DETERMINISTIC function of tenantId — reconcile is idempotent and the
// same tenant always lands on the same minute (no drift across re-reconciles).
// Defaults to 0 (no jitter) so single-tenant AGENTLOOP behavior is unchanged; an
// operator sets PIPELINE_JITTER_WINDOW_MINUTES once multiple tenants share times.
export const PIPELINE_JITTER_WINDOW_MINUTES = Number(
  process.env.PIPELINE_JITTER_WINDOW_MINUTES ?? "0",
);

export function jitterMinutes(tenantId: string, windowMinutes: number): number {
  if (windowMinutes <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < tenantId.length; i += 1) {
    hash = (hash * 31 + tenantId.charCodeAt(i)) % 2147483647;
  }
  return hash % windowMinutes;
}

export function toCronPlusMinutes(hhmm: string, minutesAfter: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  const dayMinutes = 24 * 60;
  const total = (h * 60 + m + minutesAfter + dayMinutes) % dayMinutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${minute} ${hour} * * *`;
}

export async function reconcilePipelineSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
  tenantId: string = AGENTLOOP_TENANT_ID,
): Promise<void> {
  const pipelineTime = settings.pipelineTime;
  const pipelineKey = schedulerKey(PIPELINE_RUN_SCHEDULER_KEY, tenantId);
  const socialHealthKey = schedulerKey(SOCIAL_HEALTH_SCHEDULER_KEY, tenantId);
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(pipelineKey);
    await queue.removeJobScheduler(socialHealthKey);
    for (const scheduler of PUBLISH_SCHEDULERS) {
      await queue.removeJobScheduler(schedulerKey(scheduler.key, tenantId));
    }
    return;
  }
  const jitteredPipelineTime = toCronPlusMinutes(
    pipelineTime,
    jitterMinutes(tenantId, PIPELINE_JITTER_WINDOW_MINUTES),
  );
  await queue.upsertJobScheduler(
    pipelineKey,
    { pattern: jitteredPipelineTime, tz: settings.scheduleTimezone },
    { name: "pipeline-run", data: { tenantId } },
  );
  await queue.upsertJobScheduler(
    socialHealthKey,
    {
      pattern: toCronMinusMinutes(
        pipelineTime,
        SOCIAL_HEALTH_LEAD_MINUTES,
      ),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: { tenantId } },
  );
  for (const scheduler of PUBLISH_SCHEDULERS) {
    const key = schedulerKey(scheduler.key, tenantId);
    if (!scheduler.enabled(settings)) {
      await queue.removeJobScheduler(key);
      continue;
    }
    await queue.upsertJobScheduler(
      key,
      { pattern: toCron(scheduler.time(settings)), tz: settings.scheduleTimezone },
      { name: scheduler.jobName, data: { tenantId } },
    );
  }
}

export async function reconcileCollectorHealthSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
  tenantId: string = AGENTLOOP_TENANT_ID,
): Promise<void> {
  const key = schedulerKey(COLLECTOR_HEALTH_SCHEDULER_KEY, tenantId);
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(key);
    return;
  }
  await queue.upsertJobScheduler(
    key,
    {
      pattern: toCronMinusMinutes(settings.pipelineTime, COLLECTOR_HEALTH_LEAD_MINUTES),
      tz: settings.scheduleTimezone,
    },
    { name: "collector-health", data: { trigger: "scheduled", tenantId } },
  );
}

export async function removeLegacySchedulers(
  queue: Pick<Queue, "removeJobScheduler">,
): Promise<void> {
  await queue.removeJobScheduler(LEGACY_DAILY_RUN_SCHEDULER_KEY);
}

export {
  COLLECTOR_HEALTH_LEAD_MINUTES,
  COLLECTOR_HEALTH_SCHEDULER_KEY,
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
  tenantId: string = AGENTLOOP_TENANT_ID,
): Promise<void> {
  const scheduleTime = settings.pipelineTime ?? settings.scheduleTime;
  if (scheduleTime === undefined) {
    throw new Error("pipelineTime or scheduleTime is required");
  }
  const dailyRunKey = schedulerKey(DAILY_RUN_SCHEDULER_KEY, tenantId);
  const socialHealthKey = schedulerKey(SOCIAL_HEALTH_SCHEDULER_KEY, tenantId);
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(dailyRunKey);
    await queue.removeJobScheduler(socialHealthKey);
    return;
  }
  await queue.upsertJobScheduler(
    dailyRunKey,
    { pattern: toCron(scheduleTime), tz: settings.scheduleTimezone },
    { name: "daily-run", data: { tenantId } },
  );
  await queue.upsertJobScheduler(
    socialHealthKey,
    {
      pattern: toCronMinusMinutes(scheduleTime, SOCIAL_HEALTH_LEAD_MINUTES),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: { tenantId } },
  );
}
