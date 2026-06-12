import type { Queue } from "bullmq";
import {
  COLLECTOR_HEALTH_LEAD_MINUTES,
  LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
  LEGACY_PROCESSING_SCHEDULER_KEYS,
  schedulerKeyFor,
  type UserSettings,
} from "@newsletter/shared";

const SOCIAL_HEALTH_LEAD_MINUTES = 15;

type SchedulerQueue = Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;

const PUBLISH_SCHEDULERS = [
  {
    kind: "email-send",
    enabled: (settings: UserSettings) => settings.emailEnabled,
    time: (settings: UserSettings) => settings.emailTime,
  },
  {
    kind: "linkedin-post",
    enabled: (settings: UserSettings) => settings.linkedinEnabled,
    time: (settings: UserSettings) => settings.linkedinTime,
  },
  {
    kind: "twitter-post",
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

// REQ-062/REQ-063: every scheduler entry is keyed per tenant and its job data
// carries { tenantId } so workers scope repos to the originating tenant.
export async function reconcilePipelineSchedule(
  queue: SchedulerQueue,
  tenantId: string,
  settings: UserSettings,
): Promise<void> {
  const pipelineKey = schedulerKeyFor("pipeline-run", tenantId);
  const socialHealthKey = schedulerKeyFor("social-health", tenantId);
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(pipelineKey);
    await queue.removeJobScheduler(socialHealthKey);
    for (const scheduler of PUBLISH_SCHEDULERS) {
      await queue.removeJobScheduler(schedulerKeyFor(scheduler.kind, tenantId));
    }
    return;
  }
  const pipelineTime = settings.pipelineTime;
  await queue.upsertJobScheduler(
    pipelineKey,
    { pattern: toCron(pipelineTime), tz: settings.scheduleTimezone },
    { name: "pipeline-run", data: { tenantId } },
  );
  await queue.upsertJobScheduler(
    socialHealthKey,
    {
      pattern: toCronMinusMinutes(pipelineTime, SOCIAL_HEALTH_LEAD_MINUTES),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: { tenantId } },
  );
  for (const scheduler of PUBLISH_SCHEDULERS) {
    const key = schedulerKeyFor(scheduler.kind, tenantId);
    if (!scheduler.enabled(settings)) {
      await queue.removeJobScheduler(key);
      continue;
    }
    await queue.upsertJobScheduler(
      key,
      { pattern: toCron(scheduler.time(settings)), tz: settings.scheduleTimezone },
      { name: scheduler.kind, data: { tenantId } },
    );
  }
}

export async function reconcileCollectorHealthSchedule(
  queue: SchedulerQueue,
  tenantId: string,
  settings: UserSettings,
): Promise<void> {
  const key = schedulerKeyFor("collector-health", tenantId);
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

export interface TenantSchedulerQueues {
  processingQueue: SchedulerQueue;
  collectorHealthQueue: SchedulerQueue;
}

/** Single reconcile entry point shared by settings PUT, boot, and (Phase 11) onboarding activation. */
export async function reconcileAllForTenant(
  queues: TenantSchedulerQueues,
  tenantId: string,
  settings: UserSettings,
): Promise<void> {
  await reconcilePipelineSchedule(queues.processingQueue, tenantId, settings);
  await reconcileCollectorHealthSchedule(queues.collectorHealthQueue, tenantId, settings);
}

export interface ActiveTenantScheduleDeps extends TenantSchedulerQueues {
  listActiveTenants: () => Promise<readonly { id: string }[]>;
  getSettings: (tenantId: string) => Promise<UserSettings | null>;
}

// Boot reconcile (REQ-063): only active tenants get schedulers — pending_setup
// tenants are excluded by listActiveTenants, and tenants without a settings
// row have nothing to schedule yet.
export async function reconcileSchedulesForActiveTenants(
  deps: ActiveTenantScheduleDeps,
): Promise<void> {
  const tenants = await deps.listActiveTenants();
  for (const tenant of tenants) {
    const settings = await deps.getSettings(tenant.id);
    if (settings === null) continue;
    await reconcileAllForTenant(deps, tenant.id, settings);
  }
}

// One-time boot cleanup: drop the pre-multi-tenancy global "<kind>:default"
// scheduler entries; per-tenant keys replace them.
export async function removeLegacySchedulers(
  queues: {
    processingQueue: Pick<Queue, "removeJobScheduler">;
    collectorHealthQueue: Pick<Queue, "removeJobScheduler">;
  },
): Promise<void> {
  for (const key of LEGACY_PROCESSING_SCHEDULER_KEYS) {
    await queues.processingQueue.removeJobScheduler(key);
  }
  await queues.collectorHealthQueue.removeJobScheduler(
    LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
  );
}

export { COLLECTOR_HEALTH_LEAD_MINUTES, schedulerKeyFor };
