import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import { AGENTLOOP_TENANT_ID, schedulerKey } from "@newsletter/shared";
import {
  DAILY_RUN_SCHEDULER_KEY,
  EMAIL_SEND_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  SOCIAL_HEALTH_SCHEDULER_KEY,
  TWITTER_POST_SCHEDULER_KEY,
  reconcilePipelineSchedule,
  reconcileDailyRunSchedule,
  toCronMinusMinutes,
  toCron,
  toCronPlusMinutes,
  jitterMinutes,
} from "@api/services/scheduler.js";

// Default (no explicit tenant) reconciliation namespaces every scheduler key
// under tenant 0 (AGENTLOOP) and stamps tenantId into the job data.
const tenantKey = (base: string) => schedulerKey(base, AGENTLOOP_TENANT_ID);
const tenantData = { tenantId: AGENTLOOP_TENANT_ID };

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

describe("reconcilePipelineSchedule", () => {
  it("upserts standing pipeline, health, and enabled publish channel schedulers", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(queue, baseSettings());

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(PIPELINE_RUN_SCHEDULER_KEY),
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "pipeline-run", data: tenantData },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(SOCIAL_HEALTH_SCHEDULER_KEY),
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: tenantData },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(EMAIL_SEND_SCHEDULER_KEY),
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: tenantData },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(LINKEDIN_POST_SCHEDULER_KEY),
      { pattern: "15 10 * * *", tz: "America/New_York" },
      { name: "linkedin-post", data: tenantData },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(TWITTER_POST_SCHEDULER_KEY),
      { pattern: "30 10 * * *", tz: "America/New_York" },
      { name: "twitter-post", data: tenantData },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("removes all standing schedulers when the schedule is disabled", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(queue, baseSettings({ scheduleEnabled: false }));

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(PIPELINE_RUN_SCHEDULER_KEY));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(SOCIAL_HEALTH_SCHEDULER_KEY));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(EMAIL_SEND_SCHEDULER_KEY));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(LINKEDIN_POST_SCHEDULER_KEY));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(TWITTER_POST_SCHEDULER_KEY));
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("removes disabled channel schedulers while keeping enabled channels", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(
      queue,
      baseSettings({ linkedinEnabled: false, twitterPostEnabled: false }),
    );

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(EMAIL_SEND_SCHEDULER_KEY),
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: tenantData },
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(LINKEDIN_POST_SCHEDULER_KEY));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(tenantKey(TWITTER_POST_SCHEDULER_KEY));
  });
});

describe("reconcileDailyRunSchedule", () => {
  it("REQ-014/REQ-021: enabled -> upsertJobScheduler with correct pattern + tz", async () => {
    const queue = makeQueue();
    await reconcileDailyRunSchedule(queue, baseSettings());
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(DAILY_RUN_SCHEDULER_KEY),
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "daily-run", data: tenantData },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      tenantKey(SOCIAL_HEALTH_SCHEDULER_KEY),
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: tenantData },
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
      tenantKey(DAILY_RUN_SCHEDULER_KEY),
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      tenantKey(SOCIAL_HEALTH_SCHEDULER_KEY),
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
  // The removed DST test asserted that Intl.DateTimeFormat renders two UTC
  // instants as 09:30 in America/New_York — it exercised the platform's
  // timezone engine, not the scheduler. The scheduler only emits the tz-naive
  // cron string (tested by toCron) + the IANA tz string (passed through to
  // upsertJobScheduler), both covered above.
});

describe("jitterMinutes / toCronPlusMinutes (F46 start-time jitter)", () => {
  it("returns 0 when the window is 0 (jitter disabled)", () => {
    expect(jitterMinutes("any-tenant", 0)).toBe(0);
  });

  it("is deterministic and stable for a given tenant + window", () => {
    const a = jitterMinutes("11111111-1111-1111-1111-111111111111", 5);
    const b = jitterMinutes("11111111-1111-1111-1111-111111111111", 5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(5);
  });

  it("spreads different tenants across the window (not all identical)", () => {
    const offsets = [
      "00000000-0000-0000-0000-000000000000",
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    ].map((t) => jitterMinutes(t, 30));
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  it("offsets a cron pattern forward, wrapping past midnight", () => {
    expect(toCronPlusMinutes("09:00", 7)).toBe("7 9 * * *");
    expect(toCronPlusMinutes("23:58", 5)).toBe("3 0 * * *");
  });
});
