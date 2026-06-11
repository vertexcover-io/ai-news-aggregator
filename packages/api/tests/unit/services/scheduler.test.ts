import { describe, it, expect, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
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

  // P9 (REQ-060): when reconciled for a tenant, every scheduler entry's job
  // data carries that tenant — the worker scopes its repos from it. Keys stay
  // the singleton `:`-form (per-tenant keys are P10 / REQ-062, D-112).
  it("REQ-060: stamps the tenantId onto every scheduler entry's job data", async () => {
    const queue = makeQueue();
    const tenantId = "11111111-2222-3333-4444-555555555555";

    await reconcilePipelineSchedule(queue, baseSettings(), tenantId);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      PIPELINE_RUN_SCHEDULER_KEY,
      { pattern: "30 9 * * *", tz: "America/New_York" },
      { name: "pipeline-run", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SOCIAL_HEALTH_SCHEDULER_KEY,
      { pattern: "15 9 * * *", tz: "America/New_York" },
      { name: "social-health", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EMAIL_SEND_SCHEDULER_KEY,
      { pattern: "0 10 * * *", tz: "America/New_York" },
      { name: "email-send", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      LINKEDIN_POST_SCHEDULER_KEY,
      { pattern: "15 10 * * *", tz: "America/New_York" },
      { name: "linkedin-post", data: { tenantId } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      TWITTER_POST_SCHEDULER_KEY,
      { pattern: "30 10 * * *", tz: "America/New_York" },
      { name: "twitter-post", data: { tenantId } },
    );
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
