import type { Queue } from "bullmq";
import {
  COLLECTOR_HEALTH_LEAD_MINUTES,
  COLLECTOR_HEALTH_SCHEDULER_KEY,
  EMAIL_SEND_SCHEDULER_KEY,
  LEGACY_DAILY_RUN_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  TWITTER_POST_SCHEDULER_KEY,
  tenantSchedulerKey,
  type UserSettings,
} from "@newsletter/shared";

export const SOCIAL_HEALTH_SCHEDULER_KEY = "social-health:default";
const SOCIAL_HEALTH_LEAD_MINUTES = 15;
const PUBLISH_SCHEDULERS = [
  {
    base: "email-send",
    legacyKey: EMAIL_SEND_SCHEDULER_KEY,
    jobName: "email-send",
    enabled: (settings: UserSettings) => settings.emailEnabled,
    time: (settings: UserSettings) => settings.emailTime,
  },
  {
    base: "linkedin-post",
    legacyKey: LINKEDIN_POST_SCHEDULER_KEY,
    jobName: "linkedin-post",
    enabled: (settings: UserSettings) => settings.linkedinEnabled,
    time: (settings: UserSettings) => settings.linkedinTime,
  },
  {
    base: "twitter-post",
    legacyKey: TWITTER_POST_SCHEDULER_KEY,
    jobName: "twitter-post",
    enabled: (settings: UserSettings) => settings.twitterPostEnabled,
    time: (settings: UserSettings) => settings.twitterTime,
  },
] as const;

export function toCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return `${m} ${h} * * *`;
}

/**
 * Per-tenant start-time jitter window (P10, REQ-066). Tenants sharing a
 * nominal pipeline time get a deterministic offset in
 * [-SCHEDULE_JITTER_MAX_ABS_MINUTES, +SCHEDULE_JITTER_MAX_ABS_MINUTES] so they
 * don't all start in the same minute. Kept well below the 15/30-minute
 * health-check leads so jitter can never reorder a run before its checks.
 */
export const SCHEDULE_JITTER_MAX_ABS_MINUTES = 3;

/**
 * Deterministic per-tenant jitter in whole minutes (REQ-066). Pure: derived
 * from an FNV-1a hash of the tenant id — never from Math.random — so the
 * scheduled minute is stable across reconciles and unit-testable.
 */
export function tenantJitterMinutes(
  tenantId: string,
  maxAbsMinutes: number = SCHEDULE_JITTER_MAX_ABS_MINUTES,
): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tenantId.length; i += 1) {
    hash ^= tenantId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const span = maxAbsMinutes * 2 + 1;
  return ((hash >>> 0) % span) - maxAbsMinutes;
}

/**
 * Scheduler-entry job data (P9, REQ-060): jobs spawned by a scheduler carry
 * the owning tenant so workers scope settings/sources/writes to it. Omitted
 * for legacy (pre-tenant) reconciles — workers then fall back to the
 * single-tenant AGENTLOOP bridge.
 */
function schedulerJobData(tenantId?: string): Record<string, unknown> {
  return tenantId !== undefined ? { tenantId } : {};
}

export function toCronMinusMinutes(hhmm: string, minutesBefore: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  const dayMinutes = 24 * 60;
  const total = (h * 60 + m - minutesBefore + dayMinutes) % dayMinutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${minute} ${hour} * * *`;
}

/**
 * Reconcile one tenant's standing schedulers (P10, REQ-062/063).
 *
 * Keys are PER TENANT — `<base>:<tenantId>` (scheduler keys keep the `:`
 * form per D-112) — so reconciling tenant B can never touch tenant A's
 * entries; the settings save path calls this for the CHANGED tenant only.
 * Legacy reconciles (no tenantId) keep the singleton `:default` keys; a
 * tenant-scoped reconcile retires those singletons so they can't double-fire
 * alongside the per-tenant entries.
 *
 * The pipeline-run start gets the deterministic per-tenant jitter (REQ-066);
 * health/publish siblings stay on the nominal times (jitter < their leads).
 */
export async function reconcilePipelineSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
  tenantId?: string,
): Promise<void> {
  const pipelineTime = settings.pipelineTime;
  const pipelineRunKey = tenantId !== undefined
    ? tenantSchedulerKey("pipeline-run", tenantId)
    : PIPELINE_RUN_SCHEDULER_KEY;
  const socialHealthKey = tenantId !== undefined
    ? tenantSchedulerKey("social-health", tenantId)
    : SOCIAL_HEALTH_SCHEDULER_KEY;
  if (tenantId !== undefined) {
    // Migration cleanup: retire the pre-P10 singleton entries.
    await queue.removeJobScheduler(PIPELINE_RUN_SCHEDULER_KEY);
    await queue.removeJobScheduler(SOCIAL_HEALTH_SCHEDULER_KEY);
    for (const scheduler of PUBLISH_SCHEDULERS) {
      await queue.removeJobScheduler(scheduler.legacyKey);
    }
  }
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(pipelineRunKey);
    await queue.removeJobScheduler(socialHealthKey);
    for (const scheduler of PUBLISH_SCHEDULERS) {
      await queue.removeJobScheduler(
        tenantId !== undefined
          ? tenantSchedulerKey(scheduler.base, tenantId)
          : scheduler.legacyKey,
      );
    }
    return;
  }
  // REQ-066: jitter the run start so tenants sharing a nominal time spread out.
  const jitteredPipelinePattern = tenantId !== undefined
    ? toCronMinusMinutes(pipelineTime, -tenantJitterMinutes(tenantId))
    : toCron(pipelineTime);
  await queue.upsertJobScheduler(
    pipelineRunKey,
    { pattern: jitteredPipelinePattern, tz: settings.scheduleTimezone },
    { name: "pipeline-run", data: schedulerJobData(tenantId) },
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
    { name: "social-health", data: schedulerJobData(tenantId) },
  );
  for (const scheduler of PUBLISH_SCHEDULERS) {
    const key = tenantId !== undefined
      ? tenantSchedulerKey(scheduler.base, tenantId)
      : scheduler.legacyKey;
    if (!scheduler.enabled(settings)) {
      await queue.removeJobScheduler(key);
      continue;
    }
    await queue.upsertJobScheduler(
      key,
      { pattern: toCron(scheduler.time(settings)), tz: settings.scheduleTimezone },
      { name: scheduler.jobName, data: schedulerJobData(tenantId) },
    );
  }
}

/**
 * Sibling per-tenant reconcile on the DEDICATED collector-health queue
 * (D-110 — never collapsed onto the processing queue). Key form mirrors
 * reconcilePipelineSchedule: `collector-health:<tenantId>` (REQ-062), with
 * the legacy singleton retired on tenant-scoped reconciles.
 */
export async function reconcileCollectorHealthSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
  tenantId?: string,
): Promise<void> {
  const key = tenantId !== undefined
    ? tenantSchedulerKey("collector-health", tenantId)
    : COLLECTOR_HEALTH_SCHEDULER_KEY;
  if (tenantId !== undefined) {
    await queue.removeJobScheduler(COLLECTOR_HEALTH_SCHEDULER_KEY);
  }
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
    {
      name: "collector-health",
      data: { trigger: "scheduled", ...schedulerJobData(tenantId) },
    },
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
