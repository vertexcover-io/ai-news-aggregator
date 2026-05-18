import { describe, expect, it, vi } from "vitest";
import { reconcilePerArchiveJobs } from "@pipeline/services/per-archive-schedule.js";
import type { UserSettings } from "@newsletter/shared";

const settings: UserSettings = {
  id: "settings-1",
  topN: 10,
  halfLifeHours: null,
  hnEnabled: true,
  hnConfig: null,
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  scheduleTime: "19:00",
  pipelineTime: "19:00",
  emailTime: "09:00",
  linkedinTime: "09:15",
  twitterTime: "09:30",
  scheduleTimezone: "UTC",
  scheduleEnabled: true,
  emailEnabled: true,
  linkedinEnabled: false,
  twitterPostEnabled: false,
  autoReview: false,
  updatedAt: "2026-05-18T00:00:00.000Z",
};

function makeQueue() {
  return {
    add: vi.fn(() => Promise.resolve({ id: "job-1" })),
    remove: vi.fn(() => Promise.resolve(1)),
    getJob: vi.fn(() => Promise.resolve(null)),
  };
}

describe("reconcilePerArchiveJobs", () => {
  it("schedules earlier publish times on the next local day", async () => {
    const queue = makeQueue();

    await reconcilePerArchiveJobs(
      { queue, now: () => new Date("2026-05-18T20:00:00.000Z") },
      "run-1",
      settings,
      {
        id: "run-1",
        status: "completed",
        completedAt: new Date("2026-05-18T19:05:00.000Z"),
        emailSentAt: null,
        linkedinPostedAt: null,
        twitterPostedAt: null,
        isDryRun: false,
      },
    );

    expect(queue.add).toHaveBeenCalledWith(
      "email-send",
      { runId: "run-1" },
      { jobId: "email-send:run-1", delay: 46_800_000 },
    );
  });

  it("schedules the review warning before the earliest overnight publish target", async () => {
    const queue = makeQueue();

    await reconcilePerArchiveJobs(
      { queue, now: () => new Date("2026-05-18T20:00:00.000Z") },
      "run-1",
      settings,
      {
        id: "run-1",
        status: "completed",
        completedAt: new Date("2026-05-18T19:05:00.000Z"),
        emailSentAt: null,
        linkedinPostedAt: null,
        twitterPostedAt: null,
        isDryRun: false,
      },
    );

    expect(queue.add).toHaveBeenCalledWith(
      "review-warning",
      { runId: "run-1" },
      { jobId: "review-warning:run-1", delay: 46_500_000 },
    );
  });

  it("keeps missed publish targets immediate", async () => {
    const queue = makeQueue();

    await reconcilePerArchiveJobs(
      { queue, now: () => new Date("2026-05-19T10:00:00.000Z") },
      "run-1",
      settings,
      {
        id: "run-1",
        status: "completed",
        completedAt: new Date("2026-05-18T19:05:00.000Z"),
        emailSentAt: null,
        linkedinPostedAt: null,
        twitterPostedAt: null,
        isDryRun: false,
      },
    );

    expect(queue.add).toHaveBeenCalledWith(
      "email-send",
      { runId: "run-1" },
      { jobId: "email-send:run-1", delay: 0 },
    );
  });

  it("short-circuits without enqueuing or removing when archive is dry-run", async () => {
    const queue = makeQueue();

    const result = await reconcilePerArchiveJobs(
      { queue, now: () => new Date("2026-05-18T20:00:00.000Z") },
      "run-1",
      settings,
      {
        id: "run-1",
        status: "completed",
        completedAt: new Date("2026-05-18T19:05:00.000Z"),
        emailSentAt: null,
        linkedinPostedAt: null,
        twitterPostedAt: null,
        isDryRun: true,
      },
    );

    expect(result).toEqual({ removed: [], enqueued: [] });
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.remove).not.toHaveBeenCalled();
  });
});
