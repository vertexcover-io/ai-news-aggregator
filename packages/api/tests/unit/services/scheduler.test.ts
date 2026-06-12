import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import {
  LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
  LEGACY_PROCESSING_SCHEDULER_KEYS,
} from "@newsletter/shared";
import {
  reconcilePipelineSchedule,
  reconcileSchedulesForActiveTenants,
  removeLegacySchedulers,
  schedulerKeyFor,
  toCronMinusMinutes,
  toCron,
} from "@api/services/scheduler.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function baseSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "s1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { sinceDays: 1 },
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "09:30",
    pipelineTime: "09:30",
    emailTime: "10:00",
    linkedinTime: "10:15",
    twitterTime: "10:30",
    scheduleTimezone: "America/New_York",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

describe("toCron", () => {
  it.each([
    { time: "09:30", cron: "30 9 * * *" },
    { time: "00:00", cron: "0 0 * * *" },
    { time: "23:59", cron: "59 23 * * *" },
  ])("converts $time to '$cron'", ({ time, cron }) => {
    expect(toCron(time)).toBe(cron);
  });
});

describe("toCronMinusMinutes", () => {
  it("subtracts minutes from the configured local wall-clock time", () => {
    expect(toCronMinusMinutes("09:30", 15)).toBe("15 9 * * *");
  });

  it("wraps before midnight when the health check precedes an early run", () => {
    expect(toCronMinusMinutes("00:05", 15)).toBe("50 23 * * *");
  });
});

describe("reconcilePipelineSchedule (per-tenant, REQ-062)", () => {
  it("upserts tenant-keyed pipeline, health, and publish schedulers with {tenantId} data", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(queue, TENANT_A, baseSettings());

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `pipeline-run:${TENANT_A}`,
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "pipeline-run", data: { tenantId: TENANT_A } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `social-health:${TENANT_A}`,
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: { tenantId: TENANT_A } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `email-send:${TENANT_A}`,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: { tenantId: TENANT_A } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `linkedin-post:${TENANT_A}`,
      { pattern: "15 10 * * *", tz: "America/New_York" },
      { name: "linkedin-post", data: { tenantId: TENANT_A } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `twitter-post:${TENANT_A}`,
      { pattern: "30 10 * * *", tz: "America/New_York" },
      { name: "twitter-post", data: { tenantId: TENANT_A } },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("removes only the disabled tenant's standing schedulers (REQ-063)", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(
      queue,
      TENANT_A,
      baseSettings({ scheduleEnabled: false }),
    );

    for (const kind of [
      "pipeline-run",
      "social-health",
      "email-send",
      "linkedin-post",
      "twitter-post",
    ] as const) {
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(
        schedulerKeyFor(kind, TENANT_A),
      );
    }
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    const removedKeys = queue.removeJobScheduler.mock.calls.map((c) => c[0] as string);
    expect(removedKeys.every((k) => k.endsWith(`:${TENANT_A}`))).toBe(true);
  });

  it("removes disabled channel schedulers while keeping enabled channels", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(
      queue,
      TENANT_A,
      baseSettings({ linkedinEnabled: false, twitterPostEnabled: false }),
    );

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `email-send:${TENANT_A}`,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: { tenantId: TENANT_A } },
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`linkedin-post:${TENANT_A}`);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`twitter-post:${TENANT_A}`);
  });
});

describe("reconcileSchedulesForActiveTenants (boot, REQ-063)", () => {
  it("reconciles every active tenant and skips tenants without settings", async () => {
    const processingQueue = makeQueue();
    const collectorHealthQueue = makeQueue();
    const pendingTenant = "cccccccc-0000-4000-8000-000000000003";
    const settingsByTenant: Record<string, UserSettings | null> = {
      [TENANT_A]: baseSettings(),
      [TENANT_B]: baseSettings({ pipelineTime: "07:00", scheduleTime: "07:00" }),
      [pendingTenant]: baseSettings(),
    };

    await reconcileSchedulesForActiveTenants({
      processingQueue,
      collectorHealthQueue,
      // pending_setup tenants never appear here — listActive filters by status.
      listActiveTenants: () => Promise.resolve([{ id: TENANT_A }, { id: TENANT_B }]),
      getSettings: (tenantId) => Promise.resolve(settingsByTenant[tenantId] ?? null),
    });

    const upsertedKeys = processingQueue.upsertJobScheduler.mock.calls.map(
      (c) => c[0] as string,
    );
    expect(upsertedKeys).toContain(`pipeline-run:${TENANT_A}`);
    expect(upsertedKeys).toContain(`pipeline-run:${TENANT_B}`);
    expect(upsertedKeys.some((k) => k.endsWith(`:${pendingTenant}`))).toBe(false);
    expect(collectorHealthQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
  });

  it("skips active tenants that have no settings row yet", async () => {
    const processingQueue = makeQueue();
    const collectorHealthQueue = makeQueue();

    await reconcileSchedulesForActiveTenants({
      processingQueue,
      collectorHealthQueue,
      listActiveTenants: () => Promise.resolve([{ id: TENANT_A }, { id: TENANT_B }]),
      getSettings: (tenantId) =>
        Promise.resolve(tenantId === TENANT_A ? baseSettings() : null),
    });

    const upsertedKeys = processingQueue.upsertJobScheduler.mock.calls.map(
      (c) => c[0] as string,
    );
    expect(upsertedKeys.every((k) => k.endsWith(`:${TENANT_A}`))).toBe(true);
  });
});

describe("removeLegacySchedulers", () => {
  it("removes every pre-multi-tenancy ':default' key from both queues", async () => {
    const processingQueue = makeQueue();
    const collectorHealthQueue = makeQueue();

    await removeLegacySchedulers({ processingQueue, collectorHealthQueue });

    for (const key of LEGACY_PROCESSING_SCHEDULER_KEYS) {
      expect(processingQueue.removeJobScheduler).toHaveBeenCalledWith(key);
    }
    expect(collectorHealthQueue.removeJobScheduler).toHaveBeenCalledWith(
      LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
    );
    expect(processingQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
