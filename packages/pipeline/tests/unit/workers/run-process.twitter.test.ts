import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RunState,
  CollectorResult,
} from "@newsletter/shared/types";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

const { mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, handler) => ({
    handler,
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
  })),
}));

vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({ findSince: vi.fn() })),
}));

vi.mock("@pipeline/repositories/run-archives.js", () => ({
  createRunArchivesRepo: vi.fn(() => ({ upsert: vi.fn(() => Promise.resolve()) })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({
    subscribe: vi.fn(() => Promise.resolve({ close: vi.fn(() => Promise.resolve()) })),
  })),
}));

// Import the twitter error classes for mock throwing
import { TwitterAuthError, TwitterRateLimitError } from "@pipeline/collectors/twitter.js";

const { createRunProcessWorker } = await import("@pipeline/workers/run-process.js");

const twitterConfig: TwitterCollectConfig = {
  users: ["openai"],
  listIds: [],
  maxPerSource: 20,
  sinceDays: 1,
};

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    status: "running",
    stage: "collecting",
    topN: 3,
    startedAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function makeMockRunState(initial: RunState | null): {
  service: RunStateService;
  updates: RunState[];
  updateSourceCalls: { type: string; patch: Record<string, unknown> }[];
} {
  const ref: { current: RunState | null } = { current: initial };
  const updates: RunState[] = [];
  const updateSourceCalls: { type: string; patch: Record<string, unknown> }[] = [];

  const service: RunStateService = {
    get: vi.fn(() => Promise.resolve(ref.current)),
    set: vi.fn((s: RunState) => {
      ref.current = s;
      return Promise.resolve();
    }),
    update: vi.fn((_runId: string, mutate: (p: RunState) => RunState) => {
      if (!ref.current) return Promise.resolve(null);
      const next = mutate(ref.current);
      ref.current = next;
      updates.push(next);
      return Promise.resolve(next);
    }),
    updateSource: vi.fn((_runId: string, type: string, patch: Record<string, unknown>) => {
      updateSourceCalls.push({ type, patch });
      return Promise.resolve();
    }),
    setStage: vi.fn(() => Promise.resolve()),
  };

  return { service, updates, updateSourceCalls };
}

const baseJobWithTwitter = {
  name: "run-process",
  id: "job-tw-1",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["twitter" as const],
    collectors: { twitter: twitterConfig },
    halfLifeHours: undefined,
  },
};

const baseJobNoCollectors = {
  name: "run-process",
  id: "job-tw-2",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: [] as ("hn" | "reddit" | "blog" | "twitter")[],
    collectors: {},
    halfLifeHours: undefined,
  },
};

describe("run-process worker — Twitter dispatch (Phase 3)", () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  // REQ-050: twitter collector is dispatched when twitter config is present
  it("REQ-050: dispatches twitter collector when twitter config is present", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const twitterFn = vi.fn((): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 3, itemsStored: 3, commentsFetched: 0, durationMs: 10 }),
    );
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobWithTwitter);

    expect(twitterFn).toHaveBeenCalledOnce();
  });

  // REQ-050: twitter collector is NOT dispatched when twitter config is absent
  it("REQ-050: does not dispatch twitter collector when twitter config is absent", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const twitterFn = vi.fn((): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: 0 }),
    );
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobNoCollectors);

    expect(twitterFn).not.toHaveBeenCalled();
  });

  // REQ-051: source status is set to "running" BEFORE the collector function executes
  it("REQ-051: updateSource is called with status='running' before the collector function executes", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const callOrder: string[] = [];

    // Track updateSource calls
    (runStateMock.service.updateSource as ReturnType<typeof vi.fn>).mockImplementation(
      (_runId: string, type: string, patch: Record<string, unknown>) => {
        callOrder.push(`updateSource:${type}:${String(patch.status)}`);
        runStateMock.updateSourceCalls.push({ type, patch });
        return Promise.resolve();
      },
    );

    const twitterFn = vi.fn((): Promise<CollectorResult> => {
      callOrder.push("collector:twitter");
      return Promise.resolve({ itemsFetched: 2, itemsStored: 2, commentsFetched: 0, durationMs: 5 });
    });
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobWithTwitter);

    const runningIdx = callOrder.indexOf("updateSource:twitter:running");
    const collectorIdx = callOrder.indexOf("collector:twitter");
    expect(runningIdx).toBeGreaterThanOrEqual(0);
    expect(collectorIdx).toBeGreaterThan(runningIdx);
  });

  // REQ-052: successful twitter collection updates source status to "completed"
  it("REQ-052: marks sources.twitter as completed on success", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const twitterFn = vi.fn((): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 5, itemsStored: 5, commentsFetched: 0, durationMs: 10 }),
    );
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobWithTwitter);

    const twitterUpdate = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "completed",
    );
    expect(twitterUpdate).toBeDefined();
    expect(twitterUpdate?.patch.itemsFetched).toBe(5);
  });

  // REQ-053: TwitterAuthError causes source to be marked failed with message
  it("REQ-053: TwitterAuthError marks sources.twitter as failed with the error message", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const authError = new TwitterAuthError("TWITTER_COOKIES_JSON not set");
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TwitterAuthError extends Error; lint doesn't detect through generics
    const twitterFn = vi.fn((): Promise<CollectorResult> => Promise.reject(authError));
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    // With only twitter failing, the run should complete (all collectors failed → run fails)
    // but the source state should be "failed"
    await worker.handler(baseJobWithTwitter);

    const twitterFailed = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "failed",
    );
    expect(twitterFailed).toBeDefined();
    expect(twitterFailed?.patch.errors).toEqual(["TWITTER_COOKIES_JSON not set"]);
  });

  // REQ-054 zero-items: TwitterRateLimitError with partialItemCount=0 marks source as failed
  it("REQ-054 zero-items: TwitterRateLimitError(msg, 0) marks sources.twitter as failed", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const rateLimitError = new TwitterRateLimitError("rate-limited at user:openai", 0);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TwitterRateLimitError extends Error; lint doesn't detect through generics
    const twitterFn = vi.fn((): Promise<CollectorResult> => Promise.reject(rateLimitError));
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobWithTwitter);

    const twitterFailed = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "failed",
    );
    expect(twitterFailed).toBeDefined();
    expect(twitterFailed?.patch.errors).toEqual(["rate-limited at user:openai"]);
  });

  // REQ-054 partial: TwitterRateLimitError with partialItemCount>0 marks source as completed
  it("REQ-054 partial: TwitterRateLimitError(msg, 3) marks sources.twitter as completed with itemsFetched=3 and errors[0]=msg", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const msg = "rate-limited at user:openai";
    const rateLimitError = new TwitterRateLimitError(msg, 3);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TwitterRateLimitError extends Error; lint doesn't detect through generics
    const twitterFn = vi.fn((): Promise<CollectorResult> => Promise.reject(rateLimitError));
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: vi.fn(),
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler(baseJobWithTwitter);

    const twitterCompleted = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "completed",
    );
    expect(twitterCompleted).toBeDefined();
    expect(twitterCompleted?.patch.itemsFetched).toBe(3);
    expect(twitterCompleted?.patch.errors).toEqual([msg]);
  });

  // REQ-055: Twitter failure does not prevent HN from being collected
  it("REQ-055: twitter failure does not block hn collector from running", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const authErr = new TwitterAuthError("TWITTER_COOKIES_JSON not set");
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TwitterAuthError extends Error; lint doesn't detect through generics
    const twitterFn = vi.fn((): Promise<CollectorResult> => Promise.reject(authErr));
    const hnFn = vi.fn((): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 2, itemsStored: 2, commentsFetched: 0, durationMs: 5 }),
    );
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: hnFn,
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    await worker.handler({
      name: "run-process",
      id: "job-tw-3",
      data: {
        runId: "run-1",
        topN: 3,
        sourceTypes: ["hn", "twitter"],
        collectors: {
          hn: { sinceDays: 1 },
          twitter: twitterConfig,
        },
      },
    });

    expect(hnFn).toHaveBeenCalledOnce();
    expect(twitterFn).toHaveBeenCalledOnce();

    const hnCompleted = runStateMock.updateSourceCalls.find(
      (c) => c.type === "hn" && c.patch.status === "completed",
    );
    const twitterFailed = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "failed",
    );
    expect(hnCompleted).toBeDefined();
    expect(twitterFailed).toBeDefined();
  });

  // EDGE-018: missing cookies ⇒ source failed but the overall run flow continues
  it("EDGE-018: cookies missing causes twitter source to fail but run still completes via HN", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const authErr2 = new TwitterAuthError("TWITTER_COOKIES_JSON not set");
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- TwitterAuthError extends Error; lint doesn't detect through generics
    const twitterFn = vi.fn((): Promise<CollectorResult> => Promise.reject(authErr2));
    const hnFn = vi.fn((): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 1, itemsStored: 1, commentsFetched: 0, durationMs: 5 }),
    );
    const loadFn = vi.fn(() => Promise.resolve([]));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: {
        hn: hnFn,
        reddit: vi.fn(),
        web: vi.fn(),
        twitter: twitterFn,
      },
    });

    const result = await worker.handler({
      name: "run-process",
      id: "job-tw-4",
      data: {
        runId: "run-1",
        topN: 3,
        sourceTypes: ["hn", "twitter"],
        collectors: {
          hn: { sinceDays: 1 },
          twitter: twitterConfig,
        },
      },
    });

    // Run should complete (not throw), twitter source is failed
    expect(result).toEqual({ rankedCount: 0 });
    const twitterFailed = runStateMock.updateSourceCalls.find(
      (c) => c.type === "twitter" && c.patch.status === "failed",
    );
    expect(twitterFailed).toBeDefined();
    expect(twitterFailed?.patch.errors).toEqual(["TWITTER_COOKIES_JSON not set"]);
  });
});
