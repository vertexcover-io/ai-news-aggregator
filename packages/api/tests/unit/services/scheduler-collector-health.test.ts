import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import {
  COLLECTOR_HEALTH_SCHEDULER_KEY,
  COLLECTOR_HEALTH_LEAD_MINUTES,
  toCronMinusMinutes,
  reconcileCollectorHealthSchedule,
} from "@api/services/scheduler.js";

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
    webSearchEnabled: false,
    webSearchConfig: null,
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
    rankingPrompt: "rank",
    shortlistPrompt: "shortlist",
    shortlistSize: 20,
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

describe("reconcileCollectorHealthSchedule", () => {
  it("REQ-011: enabled -> upsertJobScheduler with toCronMinusMinutes(pipelineTime, 30) + tz", async () => {
    const queue = makeQueue();
    const settings = baseSettings({ pipelineTime: "09:30", scheduleTimezone: "America/New_York" });

    await reconcileCollectorHealthSchedule(queue, settings);

    const expectedPattern = toCronMinusMinutes("09:30", COLLECTOR_HEALTH_LEAD_MINUTES);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      COLLECTOR_HEALTH_SCHEDULER_KEY,
      { pattern: expectedPattern, tz: "America/New_York" },
      { name: "collector-health", data: { trigger: "scheduled" } },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  // "changing pipelineTime changes the cron pattern" was removed: it asserted
  // pattern1 !== pattern2 and then re-derived both via the same
  // toCronMinusMinutes — tautological and redundant with the explicit-pattern
  // cases (REQ-011 above and EDGE-007 below).

  it("REQ-012: scheduleEnabled=false -> removeJobScheduler, no upsert", async () => {
    const queue = makeQueue();

    await reconcileCollectorHealthSchedule(queue, baseSettings({ scheduleEnabled: false }));

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(COLLECTOR_HEALTH_SCHEDULER_KEY);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  // P10 (REQ-062, D-110): collector-health stays a sibling PER-TENANT key on
  // its dedicated queue — `collector-health:<tenantId>` — and a tenant-scoped
  // reconcile retires the legacy singleton key.
  it("REQ-062: keys the collector-health entry per tenant on its dedicated queue", async () => {
    const queue = makeQueue();
    const tenantId = "11111111-2222-3333-4444-555555555555";

    await reconcileCollectorHealthSchedule(queue, baseSettings(), tenantId);

    const expectedPattern = toCronMinusMinutes("09:30", COLLECTOR_HEALTH_LEAD_MINUTES);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `collector-health:${tenantId}`,
      { pattern: expectedPattern, tz: "America/New_York" },
      { name: "collector-health", data: { trigger: "scheduled", tenantId } },
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(COLLECTOR_HEALTH_SCHEDULER_KEY);
  });

  it("REQ-062: disabled schedule removes the tenant's collector-health key", async () => {
    const queue = makeQueue();
    const tenantId = "22222222-3333-4444-5555-666666666666";

    await reconcileCollectorHealthSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
      tenantId,
    );

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`collector-health:${tenantId}`);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("EDGE-007: pipelineTime '00:15' -> pattern '45 23 * * *' (wraps before midnight)", async () => {
    const queue = makeQueue();
    await reconcileCollectorHealthSchedule(queue, baseSettings({ pipelineTime: "00:15" }));

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      COLLECTOR_HEALTH_SCHEDULER_KEY,
      { pattern: "45 23 * * *", tz: "America/New_York" },
      { name: "collector-health", data: { trigger: "scheduled" } },
    );
  });
});
