import { describe, it, expect, vi } from "vitest";
import type { RunState } from "@newsletter/shared/types";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type { RunProcessNotifier } from "@pipeline/workers/run-process.js";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, handler, opts) => ({
    handler,
    options: opts,
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getDb: vi.fn(() => ({ fake: "db" })),
  };
});

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({
    upsertItems: vi.fn(),
    updateRecapData: vi.fn(() => Promise.resolve()),
    findByIds: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({ findSince: vi.fn() })),
}));

vi.mock("@pipeline/repositories/run-archives.js", () => ({
  createRunArchivesRepo: vi.fn(() => ({ upsert: vi.fn(() => Promise.resolve()) })),
}));

vi.mock("@pipeline/repositories/run-logs.js", () => ({
  createRunLogRepo: vi.fn(() => ({ append: vi.fn(() => Promise.resolve()) })),
}));

vi.mock("@pipeline/repositories/user-settings.js", () => ({
  createUserSettingsRepo: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(null)) })),
  createNotificationSettingsRepo: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(null)) })),
}));

vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({
    subscribe: vi.fn(() => Promise.resolve({ close: vi.fn(() => Promise.resolve()) })),
  })),
}));

const { createRunProcessWorker } = await import("@pipeline/workers/run-process.js");
const { CancelledError } = await import("@pipeline/lib/cancelled-error.js");

function makeRunState(): RunStateService {
  const state: RunState = {
    id: "run-1",
    status: "running",
    stage: "collecting",
    topN: 3,
    startedAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
  };
  const ref = { current: state };
  return {
    get: vi.fn(() => Promise.resolve(ref.current)),
    set: vi.fn(() => Promise.resolve()),
    update: vi.fn((_runId: string, mutate: (p: RunState) => RunState) => {
      ref.current = mutate(ref.current);
      return Promise.resolve(ref.current);
    }),
    updateSource: vi.fn(() => Promise.resolve()),
    setStage: vi.fn(() => Promise.resolve()),
  };
}

function makeNotifier(): RunProcessNotifier & { notifyRunCrashed: ReturnType<typeof vi.fn> } {
  return {
    notifyNewsletterSent: vi.fn(() => Promise.resolve()),
    notifyReviewPending: vi.fn(() => Promise.resolve()),
    notifyReviewWarning: vi.fn(() => Promise.resolve()),
    notifyPublishFailed: vi.fn(() => Promise.resolve()),
    notifySourceDistribution: vi.fn(() => Promise.resolve()),
    notifyEmailDelivery: vi.fn(() => Promise.resolve()),
    notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
    notifyTwitterPosted: vi.fn(() => Promise.resolve()),
    notifySubscriberConfirmed: vi.fn(() => Promise.resolve()),
    notifySubscriberRemoved: vi.fn(() => Promise.resolve()),
    notifyFeedbackReceived: vi.fn(() => Promise.resolve()),
    notifyRunCrashed: vi.fn(() => Promise.resolve()),
  };
}

const baseJob = {
  name: "run-process",
  id: "job-1",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["hn"] as ("hn" | "reddit" | "blog" | "twitter")[],
    collectors: {},
  },
};

describe("run-process crash notification (REQ-091)", () => {
  it("a crashed run calls notifyRunCrashed with runId/stage/error and rethrows", async () => {
    const notifier = makeNotifier();
    const worker = createRunProcessWorker({
      runState: makeRunState(),
      loadFn: vi.fn(() => Promise.reject(new Error("db exploded"))),
      slackNotifier: notifier,
    });

    await expect(worker.handler(baseJob)).rejects.toThrow("db exploded");

    expect(notifier.notifyRunCrashed).toHaveBeenCalledTimes(1);
    expect(notifier.notifyRunCrashed).toHaveBeenCalledWith({
      runId: "run-1",
      stage: expect.any(String),
      error: "db exploded",
    });
  });

  it("a cancelled run does NOT call notifyRunCrashed", async () => {
    const notifier = makeNotifier();
    const worker = createRunProcessWorker({
      runState: makeRunState(),
      loadFn: vi.fn(() =>
        Promise.resolve().then((): never => {
          throw new CancelledError("run-1");
        }),
      ),
      slackNotifier: notifier,
    });

    await expect(worker.handler(baseJob)).resolves.toEqual({ rankedCount: 0 });

    expect(notifier.notifyRunCrashed).not.toHaveBeenCalled();
  });

  it("a notifier failure never masks the original crash", async () => {
    const notifier = makeNotifier();
    notifier.notifyRunCrashed.mockRejectedValue(new Error("slack down"));
    const worker = createRunProcessWorker({
      runState: makeRunState(),
      loadFn: vi.fn(() => Promise.reject(new Error("db exploded"))),
      slackNotifier: notifier,
    });

    await expect(worker.handler(baseJob)).rejects.toThrow("db exploded");
  });

  it("a plain SlackNotifier without notifyRunCrashed is tolerated", async () => {
    const { notifyRunCrashed: _omit, ...plain } = makeNotifier();
    const worker = createRunProcessWorker({
      runState: makeRunState(),
      loadFn: vi.fn(() => Promise.reject(new Error("db exploded"))),
      slackNotifier: plain,
    });

    await expect(worker.handler(baseJob)).rejects.toThrow("db exploded");
  });
});
