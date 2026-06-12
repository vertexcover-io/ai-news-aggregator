import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import {
  COLLECTOR_HEALTH_LEAD_MINUTES,
  schedulerKeyFor,
  toCronMinusMinutes,
  reconcileCollectorHealthSchedule,
} from "@api/services/scheduler.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const COLLECTOR_HEALTH_KEY_A = schedulerKeyFor("collector-health", TENANT_A);

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

    await reconcileCollectorHealthSchedule(queue, TENANT_A, settings);

    const expectedPattern = toCronMinusMinutes("09:30", COLLECTOR_HEALTH_LEAD_MINUTES);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      COLLECTOR_HEALTH_KEY_A,
      { pattern: expectedPattern, tz: "America/New_York" },
      { name: "collector-health", data: { trigger: "scheduled", tenantId: TENANT_A } },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  // "changing pipelineTime changes the cron pattern" was removed: it asserted
  // pattern1 !== pattern2 and then re-derived both via the same
  // toCronMinusMinutes — tautological and redundant with the explicit-pattern
  // cases (REQ-011 above and EDGE-007 below).

  it("REQ-012: scheduleEnabled=false -> removeJobScheduler, no upsert", async () => {
    const queue = makeQueue();

    await reconcileCollectorHealthSchedule(
      queue,
      TENANT_A,
      baseSettings({ scheduleEnabled: false }),
    );

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(COLLECTOR_HEALTH_KEY_A);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("EDGE-007: pipelineTime '00:15' -> pattern '45 23 * * *' (wraps before midnight)", async () => {
    const queue = makeQueue();
    await reconcileCollectorHealthSchedule(
      queue,
      TENANT_A,
      baseSettings({ pipelineTime: "00:15" }),
    );

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      COLLECTOR_HEALTH_KEY_A,
      { pattern: "45 23 * * *", tz: "America/New_York" },
      { name: "collector-health", data: { trigger: "scheduled", tenantId: TENANT_A } },
    );
  });
});
