import { describe, it, expect, vi } from "vitest";
import type { Queue } from "bullmq";
import {
  reconcilePipelineSchedule,
  HEALTH_CHECK_SCHEDULER_KEY,
  SOCIAL_HEALTH_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
} from "../scheduler.js";

type MockQueue = Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;

function makeQueue(): MockQueue & { upsertJobScheduler: ReturnType<typeof vi.fn>; removeJobScheduler: ReturnType<typeof vi.fn> } {
  return {
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "singleton",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: false,
    hnConfig: null,
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
    scheduleTime: "08:00",
    pipelineTime: "08:00",
    emailTime: "09:00",
    linkedinTime: "10:00",
    twitterTime: "10:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "",
    shortlistPrompt: "",
    shortlistSize: 50,
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("reconcilePipelineSchedule", () => {
  it("upserts the health-check scheduler when schedule is enabled", async () => {
    const queue = makeQueue();
    await reconcilePipelineSchedule(queue, makeSettings());

    // Verify the health-check scheduler was upserted at pipelineTime - 15 min
    // pipelineTime "08:00" - 15 = "07:45"
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      HEALTH_CHECK_SCHEDULER_KEY,
      { pattern: "45 7 * * *", tz: "UTC" },
      { name: "health-check", data: { triggeredBy: "scheduled" } },
    );
  });

  it("recalculates the health-check cron when pipelineTime changes", async () => {
    const queue = makeQueue();
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ pipelineTime: "12:30" }),
    );

    // 12:30 - 15 min = 12:15
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      HEALTH_CHECK_SCHEDULER_KEY,
      { pattern: "15 12 * * *", tz: "UTC" },
      { name: "health-check", data: { triggeredBy: "scheduled" } },
    );
  });

  it("removes the health-check scheduler when schedule is disabled", async () => {
    const queue = makeQueue();
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ scheduleEnabled: false }),
    );

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      HEALTH_CHECK_SCHEDULER_KEY,
    );
  });

  it("removes the health-check scheduler alongside other schedulers on disable", async () => {
    const queue = makeQueue();
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ scheduleEnabled: false }),
    );

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      PIPELINE_RUN_SCHEDULER_KEY,
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      SOCIAL_HEALTH_SCHEDULER_KEY,
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      HEALTH_CHECK_SCHEDULER_KEY,
    );
  });

  it("handles midnight-wrap correctly for pipelineTime before 00:15", async () => {
    const queue = makeQueue();
    // 00:05 - 15 min = 23:50 previous day
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ pipelineTime: "00:05" }),
    );

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      HEALTH_CHECK_SCHEDULER_KEY,
      { pattern: "50 23 * * *", tz: "UTC" },
      { name: "health-check", data: { triggeredBy: "scheduled" } },
    );
  });
});
