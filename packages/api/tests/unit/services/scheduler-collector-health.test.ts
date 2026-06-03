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

  it("REQ-011: changing pipelineTime changes the cron pattern", async () => {
    const queue1 = makeQueue();
    await reconcileCollectorHealthSchedule(queue1, baseSettings({ pipelineTime: "09:30" }));
    const call1 = queue1.upsertJobScheduler.mock.calls[0];
    const pattern1 = (call1[1] as { pattern: string }).pattern;

    const queue2 = makeQueue();
    await reconcileCollectorHealthSchedule(queue2, baseSettings({ pipelineTime: "14:00" }));
    const call2 = queue2.upsertJobScheduler.mock.calls[0];
    const pattern2 = (call2[1] as { pattern: string }).pattern;

    expect(pattern1).not.toBe(pattern2);
    expect(pattern1).toBe(toCronMinusMinutes("09:30", COLLECTOR_HEALTH_LEAD_MINUTES));
    expect(pattern2).toBe(toCronMinusMinutes("14:00", COLLECTOR_HEALTH_LEAD_MINUTES));
  });

  it("REQ-012: scheduleEnabled=false -> removeJobScheduler, no upsert", async () => {
    const queue = makeQueue();

    await reconcileCollectorHealthSchedule(queue, baseSettings({ scheduleEnabled: false }));

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(COLLECTOR_HEALTH_SCHEDULER_KEY);
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
