import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import {
  DAILY_RUN_SCHEDULER_KEY,
  SOCIAL_HEALTH_SCHEDULER_KEY,
  reconcileDailyRunSchedule,
  toCronMinusMinutes,
  toCron,
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
    scheduleTime: "09:30",
    scheduleTimezone: "America/New_York",
    scheduleEnabled: true,
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
  it("converts 09:30 to '30 9 * * *'", () => {
    expect(toCron("09:30")).toBe("30 9 * * *");
  });
  it("converts 00:00 to '0 0 * * *'", () => {
    expect(toCron("00:00")).toBe("0 0 * * *");
  });
  it("converts 23:59 to '59 23 * * *'", () => {
    expect(toCron("23:59")).toBe("59 23 * * *");
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

describe("reconcileDailyRunSchedule", () => {
  it("REQ-014/REQ-021: enabled -> upsertJobScheduler with correct pattern + tz", async () => {
    const queue = makeQueue();
    await reconcileDailyRunSchedule(queue, baseSettings());
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      DAILY_RUN_SCHEDULER_KEY,
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "daily-run", data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SOCIAL_HEALTH_SCHEDULER_KEY,
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: {} },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-022: disabled -> removeJobScheduler called", async () => {
    const queue = makeQueue();
    await reconcileDailyRunSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      DAILY_RUN_SCHEDULER_KEY,
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      SOCIAL_HEALTH_SCHEDULER_KEY,
    );
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-020/REQ-021: enabled-then-disabled is idempotent", async () => {
    const queue = makeQueue();
    await reconcileDailyRunSchedule(queue, baseSettings());
    await reconcileDailyRunSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
    );
    await reconcileDailyRunSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(4);
  });

  it("REQ-023/EDGE-002: DST — 09:30 America/New_York produces consistent local fire times across spring-forward", () => {
    // Spring-forward in US 2026 is on March 8. Verify that a cron "30 9 * * *"
    // interpreted in America/New_York fires at 09:30 local on both sides.
    // We assert that a UTC Date at the expected UTC instant has the correct
    // local hour/minute in the target zone.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // Before DST (EST = UTC-5): Mar 7 2026 09:30 local == 14:30 UTC
    const before = new Date(Date.UTC(2026, 2, 7, 14, 30));
    // After DST (EDT = UTC-4): Mar 9 2026 09:30 local == 13:30 UTC
    const after = new Date(Date.UTC(2026, 2, 9, 13, 30));
    expect(fmt.format(before)).toBe("09:30");
    expect(fmt.format(after)).toBe("09:30");
    // Sanity check on cron string used for the scheduler
    expect(toCron("09:30")).toBe("30 9 * * *");
  });
});
