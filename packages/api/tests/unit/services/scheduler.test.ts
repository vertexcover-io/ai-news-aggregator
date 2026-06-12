import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import {
  DAILY_RUN_SCHEDULER_KEY,
  EMAIL_SEND_SCHEDULER_KEY,
  LINKEDIN_POST_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  SCHEDULE_JITTER_MAX_ABS_MINUTES,
  SOCIAL_HEALTH_SCHEDULER_KEY,
  TWITTER_POST_SCHEDULER_KEY,
  reconcilePipelineSchedule,
  reconcileDailyRunSchedule,
  tenantJitterMinutes,
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
      PIPELINE_RUN_SCHEDULER_KEY,
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "pipeline-run", data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SOCIAL_HEALTH_SCHEDULER_KEY,
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EMAIL_SEND_SCHEDULER_KEY,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      LINKEDIN_POST_SCHEDULER_KEY,
      { pattern: "15 10 * * *", tz: "America/New_York" },
      { name: "linkedin-post", data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      TWITTER_POST_SCHEDULER_KEY,
      { pattern: "30 10 * * *", tz: "America/New_York" },
      { name: "twitter-post", data: {} },
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  // P10 (REQ-062, D-112): when reconciled for a tenant, every scheduler entry
  // lives under that tenant's own `:`-delimited key and carries the tenant in
  // its job data (REQ-060). The pipeline-run start time gets a deterministic
  // per-tenant jitter (REQ-066); sibling health/publish entries stay nominal.
  it("REQ-062: keys every scheduler entry per tenant and stamps job data", async () => {
    const queue = makeQueue();
    const tenantId = "11111111-2222-3333-4444-555555555555";
    const jitter = tenantJitterMinutes(tenantId);

    await reconcilePipelineSchedule(queue, baseSettings(), tenantId);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `pipeline-run:${tenantId}`,
      { pattern: toCronMinusMinutes("09:30", -jitter), tz: "America/New_York" },
      { name: "pipeline-run", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `social-health:${tenantId}`,
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `email-send:${tenantId}`,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `linkedin-post:${tenantId}`,
      { pattern: "15 10 * * *", tz: "America/New_York" },
      { name: "linkedin-post", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `twitter-post:${tenantId}`,
      { pattern: "30 10 * * *", tz: "America/New_York" },
      { name: "twitter-post", data: { tenantId } },
    );
  });

  // Migration cleanup: a tenant-scoped reconcile retires the legacy singleton
  // `:default` entries so they can never double-fire alongside per-tenant keys.
  it("REQ-062: tenant-scoped reconcile removes the legacy singleton keys", async () => {
    const queue = makeQueue();
    const tenantId = "11111111-2222-3333-4444-555555555555";

    await reconcilePipelineSchedule(queue, baseSettings(), tenantId);

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(PIPELINE_RUN_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(SOCIAL_HEALTH_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(EMAIL_SEND_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(LINKEDIN_POST_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(TWITTER_POST_SCHEDULER_KEY);
  });

  // REQ-063: reconciling tenant B must not touch tenant A's keys. Every key
  // the reconcile mentions is either B's own or a legacy `:default` singleton.
  it("test_REQ_063_settings_change_reconciles_only_that_tenant", async () => {
    const queue = makeQueue();
    const tenantA = "aaaaaaaa-0000-0000-0000-000000000001";
    const tenantB = "bbbbbbbb-0000-0000-0000-000000000002";

    await reconcilePipelineSchedule(queue, baseSettings(), tenantA);
    queue.upsertJobScheduler.mockClear();
    queue.removeJobScheduler.mockClear();

    await reconcilePipelineSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
      tenantB,
    );

    const touchedKeys = [
      ...queue.upsertJobScheduler.mock.calls.map((c) => c[0] as string),
      ...queue.removeJobScheduler.mock.calls.map((c) => c[0] as string),
    ];
    expect(touchedKeys.length).toBeGreaterThan(0);
    for (const key of touchedKeys) {
      expect(key.includes(tenantA)).toBe(false);
      expect(key.endsWith(`:${tenantB}`) || key.endsWith(":default")).toBe(true);
    }
  });

  it("REQ-062: disabling a tenant's schedule removes only that tenant's keys", async () => {
    const queue = makeQueue();
    const tenantId = "22222222-3333-4444-5555-666666666666";

    await reconcilePipelineSchedule(
      queue,
      baseSettings({ scheduleEnabled: false }),
      tenantId,
    );

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`pipeline-run:${tenantId}`);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`social-health:${tenantId}`);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`email-send:${tenantId}`);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`linkedin-post:${tenantId}`);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(`twitter-post:${tenantId}`);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("removes all standing schedulers when the schedule is disabled", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(queue, baseSettings({ scheduleEnabled: false }));

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(PIPELINE_RUN_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(SOCIAL_HEALTH_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(EMAIL_SEND_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(LINKEDIN_POST_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(TWITTER_POST_SCHEDULER_KEY);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("removes disabled channel schedulers while keeping enabled channels", async () => {
    const queue = makeQueue();

    await reconcilePipelineSchedule(
      queue,
      baseSettings({ linkedinEnabled: false, twitterPostEnabled: false }),
    );

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EMAIL_SEND_SCHEDULER_KEY,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: {} },
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(LINKEDIN_POST_SCHEDULER_KEY);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(TWITTER_POST_SCHEDULER_KEY);
  });
});

// P10 (REQ-066): start-time jitter is a PURE function of the tenant id —
// deterministic (same input → same output), bounded by ±SCHEDULE_JITTER_MAX_ABS_MINUTES,
// and spread across the window so tenants sharing a nominal time don't all
// start in the same minute.
describe("tenantJitterMinutes", () => {
  it("test_REQ_066_jitter_spreads_start_times", () => {
    const tenantIds = Array.from(
      { length: 64 },
      (_, i) => `tenant-${i.toString().padStart(4, "0")}-aaaa-bbbb-cccc`,
    );
    const values = tenantIds.map((id) => tenantJitterMinutes(id));

    // deterministic: re-computing yields identical values
    expect(tenantIds.map((id) => tenantJitterMinutes(id))).toEqual(values);
    // bounded: every value within ±max
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(SCHEDULE_JITTER_MAX_ABS_MINUTES);
    }
    // spread: a population of tenants lands on several distinct offsets
    expect(new Set(values).size).toBeGreaterThanOrEqual(3);
  });

  it("honors a custom jitter window", () => {
    for (let i = 0; i < 32; i += 1) {
      const v = tenantJitterMinutes(`t-${i}`, 10);
      expect(Math.abs(v)).toBeLessThanOrEqual(10);
    }
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
  // The removed DST test asserted that Intl.DateTimeFormat renders two UTC
  // instants as 09:30 in America/New_York — it exercised the platform's
  // timezone engine, not the scheduler. The scheduler only emits the tz-naive
  // cron string (tested by toCron) + the IANA tz string (passed through to
  // upsertJobScheduler), both covered above.
});
