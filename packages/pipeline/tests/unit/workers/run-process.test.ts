import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RunState,
  RankedItemRef,
  CollectorResult,
} from "@newsletter/shared/types";
import type { Candidate } from "@pipeline/services/candidate-loader.js";
import type { RankResult, RankOptions } from "@pipeline/processors/rank.js";
import type {
  ShortlistOptions,
  ShortlistResult,
} from "@pipeline/processors/shortlist.js";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  TwitterCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";
import type { TwitterClient } from "@pipeline/collectors/twitter/types.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, handler) => ({
    handler,
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getDb: vi.fn(() => ({ fake: "db" })),
  };
});

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

const mockUpdateRecapData = vi.fn(() => Promise.resolve());
vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ upsertItems: vi.fn(), updateRecapData: mockUpdateRecapData })),
}));

vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({ findSince: vi.fn() })),
}));

vi.mock("@pipeline/repositories/run-archives.js", () => ({
  createRunArchivesRepo: vi.fn(() => ({ upsert: vi.fn() })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

// Default no-op cancel subscriber so tests don't need real Redis
vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({
    subscribe: vi.fn(() => Promise.resolve({ close: vi.fn(() => Promise.resolve()) })),
  })),
}));

const { createRunProcessWorker } = await import(
  "@pipeline/workers/run-process.js"
);
const { CancelledError } = await import("@pipeline/lib/cancelled-error.js");
import type { CancelSubscriberFactory } from "@pipeline/services/cancel-subscriber.js";

interface JobLike {
  name: string;
  id?: string;
  data: {
    runId: string;
    topN: number;
    sourceTypes: ("hn" | "reddit" | "blog" | "twitter")[];
    collectors: { hn?: unknown; reddit?: unknown; web?: unknown; twitter?: unknown };
    halfLifeHours?: number;
  };
}

function makeShortlistFn(
  result: (cands: Candidate[]) => ShortlistResult,
): (cands: Candidate[], opts: ShortlistOptions) => Promise<ShortlistResult> {
  return (cands) => Promise.resolve(result(cands));
}

function passthroughShortlist(cands: Candidate[]): ShortlistResult {
  return {
    shortlist: cands,
    breakdowns: cands.map((c) => ({
      id: c.id,
      relevance: 0,
      recency: 1,
      combined: 1,
    })),
  };
}

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    status: "running",
    stage: "collecting",
    topN: 3,
    startedAt: "2026-04-07T10:00:00.000Z",
    updatedAt: "2026-04-07T10:00:00.000Z",
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function makeCandidate(id: number, url = `https://example.com/${id}`): Candidate {
  return {
    id,
    title: `Item ${id}`,
    url,
    sourceType: "hn",
    author: "alice",
    publishedAt: new Date("2026-04-07T09:00:00.000Z"),
    engagement: { points: 10 + id, commentCount: id },
  };
}

interface MockRunStateService {
  service: RunStateService;
  state: RunState | null;
  updates: RunState[];
  stageCalls: { runId: string; stage: string }[];
}

function makeMockRunState(initial: RunState | null): MockRunStateService {
  const ref: { current: RunState | null } = { current: initial };
  const updates: RunState[] = [];
  const stageCalls: { runId: string; stage: string }[] = [];
  const service: RunStateService = {
    get: vi.fn(() => Promise.resolve(ref.current)),
    set: vi.fn((s: RunState) => {
      ref.current = s;
      return Promise.resolve();
    }),
    update: vi.fn((runId: string, mutate: (p: RunState) => RunState) => {
      if (!ref.current) return Promise.resolve(null);
      const next = mutate(ref.current);
      ref.current = next;
      updates.push(next);
      return Promise.resolve(next);
    }),
    updateSource: vi.fn(() => Promise.resolve()),
    setStage: vi.fn((runId: string, stage) => {
      stageCalls.push({ runId, stage });
      if (ref.current) {
        ref.current = { ...ref.current, stage };
      }
      return Promise.resolve();
    }),
  };
  return { service, state: ref.current, updates, stageCalls };
}

const baseJob: JobLike = {
  name: "run-process",
  id: "job-1",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["hn", "reddit"],
    collectors: {},
  },
};

describe("run-process worker", () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
    mockUpdateRecapData.mockClear();
  });

  // REQ-044 / EDGE-001
  it("writes empty rankedItems with warning when no candidates collected", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
    const rankFn = vi.fn();
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
    });

    const result = await worker.handler(baseJob);

    expect(loadFn).toHaveBeenCalledOnce();
    expect(rankFn).not.toHaveBeenCalled();
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.stage).toBe("completed");
    expect(last?.rankedItems).toEqual([]);
    expect(last?.warnings).toContain("no items collected");
    expect(last?.completedAt).not.toBeNull();
    const completedLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.completed",
    );
    expect(completedLog).toBeDefined();
    expect(result).toEqual({ rankedCount: 0 });
  });

  // EDGE-013: null run-state → fallback to now - 10 min
  it("falls back to now-10min window and logs warning when run-state is null", async () => {
    const runStateMock = makeMockRunState(null);
    let capturedSince: Date | undefined;
    const loadFn = vi.fn((_repo, since: Date): Promise<Candidate[]> => {
      capturedSince = since;
      return Promise.resolve([]);
    });
    const rankFn = vi.fn();
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
    });

    const before = Date.now();
    await worker.handler(baseJob);
    const after = Date.now();

    expect(capturedSince).toBeDefined();
    const since = capturedSince?.getTime() ?? 0;
    expect(since).toBeGreaterThanOrEqual(before - 10 * 60 * 1000 - 50);
    expect(since).toBeLessThanOrEqual(after - 10 * 60 * 1000 + 50);
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  // EDGE-013 happy variant: run-state with startedAt uses it
  it("uses run-state startedAt as since window when present", async () => {
    const state = makeRunState({ startedAt: "2026-04-07T08:00:00.000Z" });
    const runStateMock = makeMockRunState(state);
    let capturedSince: Date | undefined;
    const loadFn = vi.fn((_repo, since: Date): Promise<Candidate[]> => {
      capturedSince = since;
      return Promise.resolve([]);
    });
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
    });

    await worker.handler(baseJob);

    expect(capturedSince?.toISOString()).toBe("2026-04-07T08:00:00.000Z");
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // REQ-064: rank throws → failed state + rethrow
  it("writes failed state and rethrows when rank throws", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));
    const rankFn = vi.fn(
      (): Promise<RankResult> => Promise.reject(new Error("rank blew up")),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
    });

    await expect(worker.handler(baseJob)).rejects.toThrow("rank blew up");
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.stage).toBe("failed");
    expect(last?.error).toBe("rank blew up");
    expect(last?.completedAt).not.toBeNull();
  });

  // Happy path: load → dedup → rank → completed
  it("loads, dedupes, ranks, and writes rankedItems on happy path", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const c1 = makeCandidate(1, "https://example.com/a");
    const c2 = makeCandidate(2, "https://example.com/a?utm_source=x"); // dup of c1
    const c3 = makeCandidate(3, "https://example.com/b");
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve([c1, c2, c3]),
    );
    const ranked: RankedItemRef[] = [
      { rawItemId: 3, score: 0.9, rationale: "best" },
      { rawItemId: 2, score: 0.7, rationale: "second" },
    ];
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: ranked,
          candidateCount: 2,
          rankedCount: 2,
        }),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn,
    });

    const result = await worker.handler(baseJob);

    expect(loadFn).toHaveBeenCalledOnce();
    expect(shortlistFn).toHaveBeenCalledOnce();
    expect(rankFn).toHaveBeenCalledOnce();
    const [rankInput, rankOpts] = rankFn.mock.calls[0] ?? [];
    expect(Array.isArray(rankInput)).toBe(true);
    // deduped from 3 → 2 (c1/c2 canonicalize to same URL, c2 has higher engagement)
    expect((rankInput as { id: number }[]).length).toBe(2);
    const opts = rankOpts as RankOptions;
    expect(opts.topN).toBe(3);
    expect(opts.runId).toBe("run-1");
    expect(opts.shortlistBreakdowns).toBeDefined();
    expect(opts.shortlistBreakdowns?.length).toBe(2);

    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.stage).toBe("completed");
    expect(last?.rankedItems).toEqual(ranked);
    expect(last?.completedAt).not.toBeNull();
    expect(result).toEqual({ rankedCount: 2 });

    // stage transitions: processing, shortlisting, ranking (via setStage)
    const stages = runStateMock.stageCalls.map((s) => s.stage);
    expect(stages).toContain("processing");
    expect(stages).toContain("shortlisting");
    expect(stages).toContain("ranking");
  });

  // Log assertions: run.dedup + run.completed with correct fields
  it("emits run.dedup and run.completed logs with runId and counts", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [
      makeCandidate(1, "https://example.com/a"),
      makeCandidate(2, "https://example.com/b"),
    ];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "ok" }],
          candidateCount: 2,
          rankedCount: 1,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
    });

    await worker.handler(baseJob);

    const dedupLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.dedup",
    );
    expect(dedupLog).toBeDefined();
    const dedupPayload = dedupLog?.[0] as {
      event: string;
      runId: string;
      inputCount: number;
      outputCount: number;
    };
    expect(dedupPayload.runId).toBe("run-1");
    expect(dedupPayload.inputCount).toBe(2);
    expect(dedupPayload.outputCount).toBe(2);

    const completedLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.completed",
    );
    expect(completedLog).toBeDefined();
    const payload = completedLog?.[0] as {
      event: string;
      runId: string;
      totalDurationMs: number;
      rankedItemCount: number;
    };
    expect(payload.runId).toBe("run-1");
    expect(typeof payload.totalDurationMs).toBe("number");
    expect(payload.rankedItemCount).toBe(1);
  });

  it("noops for non run-process job names so daily-run can share the queue", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const loadFn = vi.fn(() => Promise.resolve([]));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
    });
    const result = await worker.handler({ ...baseJob, name: "daily-run" });
    expect(result).toEqual({ rankedCount: 0 });
    expect(loadFn).not.toHaveBeenCalled();
  });

  // REQ-015: collectFns injection seam exists on RunProcessDeps
  it("REQ-015: createRunProcessWorker accepts collectFns option", () => {
    const runStateMock = makeMockRunState(makeRunState());
    const hn = vi.fn();
    const reddit = vi.fn();
    const web = vi.fn();
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web },
    });
    expect(worker).toBeDefined();
  });

  // REQ-004: stage is set to "collecting" before any collector runs
  it("REQ-004: sets stage to 'collecting' before invoking any collector", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const seenStagesAtFirstCall: string[] = [];
    const hn = vi.fn(() => {
      seenStagesAtFirstCall.push(
        runStateMock.stageCalls.map((s) => s.stage).join(","),
      );
      return Promise.resolve({
        itemsFetched: 0,
        itemsStored: 0,
        failures: 0,
        durationMs: 1,
      });
    });
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit: vi.fn(), web: vi.fn() },
    });
    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn"],
        collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
      },
    });
    // At least one stage transition ("collecting") must have happened before the
    // collector was called.
    expect(seenStagesAtFirstCall[0]).toContain("collecting");
  });

  // REQ-005: parallel dispatch — all collectors start before any resolve
  it("REQ-005: invokes all requested collectors concurrently", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const hnStart = createDeferred<undefined>();
    const redditStart = createDeferred<undefined>();
    const webStart = createDeferred<undefined>();
    const hnResolve = createDeferred<CollectorResult>();
    const redditResolve = createDeferred<CollectorResult>();
    const webResolve = createDeferred<CollectorResult>();

    const hn = vi.fn(() => {
      hnStart.resolve(undefined);
      return hnResolve.promise;
    });
    const reddit = vi.fn(() => {
      redditStart.resolve(undefined);
      return redditResolve.promise;
    });
    const web = vi.fn(() => {
      webStart.resolve(undefined);
      return webResolve.promise;
    });
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web },
    });

    const handlerPromise = worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit", "blog"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
          web: {
            sources: [{ name: "x", listingUrl: "https://x.com" }],
            maxItems: 5,
          } as unknown as WebCollectConfig,
        },
      },
    });

    // All three must have started before any resolves.
    await Promise.all([hnStart.promise, redditStart.promise, webStart.promise]);
    hnResolve.resolve({
      itemsFetched: 1,
      itemsStored: 1,
      failures: 0,
      durationMs: 1,
    });
    redditResolve.resolve({
      itemsFetched: 2,
      itemsStored: 2,
      failures: 0,
      durationMs: 1,
    });
    webResolve.resolve({
      itemsFetched: 3,
      itemsStored: 3,
      failures: 0,
      durationMs: 1,
    });
    await handlerPromise;
  });

  // REQ-006: progressive per-source state updates
  it("REQ-006: progressively marks sources completed as each collector resolves", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const redditGate = createDeferred<CollectorResult>();
    const updateSourceCalls: {
      type: string;
      patch: Record<string, unknown>;
    }[] = [];
    runStateMock.service.updateSource = vi.fn(
      (_runId: string, type: string, patch: Record<string, unknown>) => {
        updateSourceCalls.push({ type, patch });
        return Promise.resolve();
      },
    );

    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 5,
        itemsStored: 5,
        failures: 0,
        durationMs: 1,
      }),
    );
    const reddit = vi.fn(() => redditGate.promise);
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web: vi.fn() },
    });

    const handlerPromise = worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
        },
      },
    });

    // Wait a few microtasks for HN to propagate its state update.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const hnCompleted = updateSourceCalls.find(
      (c) => c.type === "hn" && c.patch.status === "completed",
    );
    const redditCompleted = updateSourceCalls.find(
      (c) => c.type === "reddit" && c.patch.status === "completed",
    );
    expect(hnCompleted).toBeDefined();
    expect(hnCompleted?.patch.itemsFetched).toBe(5);
    expect(redditCompleted).toBeUndefined(); // reddit still gated

    redditGate.resolve({
      itemsFetched: 2,
      itemsStored: 2,
      failures: 0,
      durationMs: 1,
    });
    await handlerPromise;
  });

  // REQ-007 / EDGE-013: one collector fails, others continue, dedup/rank still runs
  it("REQ-007/EDGE-013: marks failing source as failed and continues with successes", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const updateSourceCalls: {
      type: string;
      patch: Record<string, unknown>;
    }[] = [];
    runStateMock.service.updateSource = vi.fn(
      (_runId: string, type: string, patch: Record<string, unknown>) => {
        updateSourceCalls.push({ type, patch });
        return Promise.resolve();
      },
    );

    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 3,
        itemsStored: 3,
        failures: 0,
        durationMs: 1,
      }),
    );
    const reddit = vi.fn(() => Promise.reject(new Error("boom")));
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve([makeCandidate(1)]),
    );
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
          candidateCount: 1,
          rankedCount: 1,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      collectFns: { hn, reddit, web: vi.fn() },
    });

    const result = await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
        },
      },
    });

    const hnCompleted = updateSourceCalls.find(
      (c) => c.type === "hn" && c.patch.status === "completed",
    );
    const redditFailed = updateSourceCalls.find(
      (c) => c.type === "reddit" && c.patch.status === "failed",
    );
    expect(hnCompleted).toBeDefined();
    expect(redditFailed).toBeDefined();
    expect(redditFailed?.patch.errors).toEqual(["boom"]);

    // Ranking still ran because HN succeeded.
    expect(rankFn).toHaveBeenCalledOnce();
    expect(result.rankedCount).toBe(1);
  });

  // REQ-008 / EDGE-002: race serialization — load-bearing test
  it("REQ-008/EDGE-002: serializes state writes so concurrent collectors do not clobber each other", async () => {
    // Simulated store with a controlled yield between read and write.
    const store = new Map<string, Record<string, unknown>>();
    store.set("run-1", { hn: null, reddit: null, web: null });

    const updateSource = vi.fn(
      async (_runId: string, type: string, patch: Record<string, unknown>) => {
        const current = store.get("run-1");
        // yield — mimics real Redis GET latency; without writeSerial, the second
        // concurrent call will read the same snapshot and overwrite the first
        await new Promise((r) => setImmediate(r));
        const next = { ...current, [type]: patch };
        store.set("run-1", next);
      },
    );

    const runStateMock = makeMockRunState(makeRunState());
    runStateMock.service.updateSource = updateSource;

    // Two collectors that resolve in the same microtask tick.
    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 1,
        itemsStored: 1,
        failures: 0,
        durationMs: 0,
      }),
    );
    const reddit = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 2,
        itemsStored: 2,
        failures: 0,
        durationMs: 0,
      }),
    );

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web: vi.fn() },
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
        },
      },
    });

    // Both sources must be present — neither overwritten.
    const final = store.get("run-1");
    expect(final?.hn).toMatchObject({ status: "completed" });
    expect(final?.reddit).toMatchObject({ status: "completed" });
  });

  // REQ-009: stage transitions to "processing" exactly once after collecting
  it("REQ-009: sets stage to 'processing' exactly once after all collectors settle", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 1,
        itemsStored: 1,
        failures: 0,
        durationMs: 1,
      }),
    );
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
      collectFns: { hn, reddit: vi.fn(), web: vi.fn() },
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn"],
        collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
      },
    });

    const processingCalls = runStateMock.stageCalls.filter(
      (s) => s.stage === "processing",
    );
    expect(processingCalls).toHaveLength(1);
  });

  // REQ-010: all collectors fail → run marked failed, dedup/rank skipped
  it("REQ-010: marks run as failed and skips ranking when every collector fails", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const hn = vi.fn(() => Promise.reject(new Error("hn boom")));
    const reddit = vi.fn(() => Promise.reject(new Error("reddit boom")));
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
    const rankFn = vi.fn();
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      collectFns: { hn, reddit, web: vi.fn() },
    });

    const result = await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
        },
      },
    });

    expect(rankFn).not.toHaveBeenCalled();
    expect(loadFn).not.toHaveBeenCalled();
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.stage).toBe("failed");
    expect(last?.error).toContain("hn boom");
    expect(last?.error).toContain("reddit boom");
    expect(last?.rankedItems).toBeNull();
    expect(result).toEqual({ rankedCount: 0 });
  });

  // REQ-016: only requested collectors are invoked
  it("REQ-016: only invokes collectors whose configs are present in the payload", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 1,
        itemsStored: 1,
        failures: 0,
        durationMs: 1,
      }),
    );
    const reddit = vi.fn(() =>
      Promise.reject(new Error("should not be called")),
    );
    const web = vi.fn(() => Promise.reject(new Error("should not be called")));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web },
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn"],
        collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
      },
    });

    expect(hn).toHaveBeenCalledOnce();
    expect(reddit).not.toHaveBeenCalled();
    expect(web).not.toHaveBeenCalled();
  });

  // REQ-017: per-source log events
  it("REQ-017: emits run.source.completed and run.source.failed logs with required fields", async () => {
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
    const runStateMock = makeMockRunState(makeRunState());
    const hn = vi.fn(() =>
      Promise.resolve({
        itemsFetched: 7,
        itemsStored: 7,
        failures: 0,
        durationMs: 1,
      }),
    );
    const reddit = vi.fn(() => Promise.reject(new Error("reddit blew up")));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit, web: vi.fn() },
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn", "reddit"],
        collectors: {
          hn: { sinceDays: 1 } as unknown as HnCollectConfig,
          reddit: {
            subreddits: ["LocalLLaMA"],
            sinceDays: 1,
          } as unknown as RedditCollectConfig,
        },
      },
    });

    const sourceCompleted = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.source.completed",
    );
    const sourceFailed = mockLoggerError.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.source.failed",
    );
    expect(sourceCompleted).toBeDefined();
    const completedFields = sourceCompleted?.[0] as {
      runId: string;
      sourceType: string;
      itemsFetched: number;
      durationMs: number;
    };
    expect(completedFields.runId).toBe("run-1");
    expect(completedFields.sourceType).toBe("hn");
    expect(completedFields.itemsFetched).toBe(7);
    expect(typeof completedFields.durationMs).toBe("number");

    expect(sourceFailed).toBeDefined();
    const failedFields = sourceFailed?.[0] as {
      runId: string;
      sourceType: string;
      error: string;
    };
    expect(failedFields.sourceType).toBe("reddit");
    expect(failedFields.error).toBe("reddit blew up");
  });

  // REQ-023: shortlist of 20 candidates is forwarded to rank verbatim
  it("REQ-023: forwards exactly the shortlist returned by shortlistFn to rankFn", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const all: Candidate[] = Array.from({ length: 50 }, (_, i) =>
      makeCandidate(i + 1, `https://example.com/${i + 1}`),
    );
    const top20 = all.slice(0, 20);
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(all));
    const shortlistFn = vi.fn(
      (): Promise<ShortlistResult> =>
        Promise.resolve({
          shortlist: top20,
          breakdowns: top20.map((c) => ({
            id: c.id,
            relevance: 0.5,
            recency: 0.9,
            combined: 0.45,
          })),
        }),
    );
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [],
          candidateCount: 20,
          rankedCount: 0,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    await worker.handler(baseJob);

    expect(rankFn).toHaveBeenCalledOnce();
    const [rankInput] = rankFn.mock.calls[0] ?? [];
    expect((rankInput as Candidate[]).length).toBe(20);
    expect((rankInput as Candidate[])[0].id).toBe(top20[0].id);
  });

  // EDGE-004: empty shortlist → skip rank, write empty rankedItems, status completed
  it("EDGE-004: short-circuits to completed with empty rankedItems when shortlistFn returns 0", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(
      (): Promise<ShortlistResult> =>
        Promise.resolve({ shortlist: [], breakdowns: [] }),
    );
    const rankFn = vi.fn();
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    const result = await worker.handler(baseJob);

    expect(shortlistFn).toHaveBeenCalledOnce();
    expect(rankFn).not.toHaveBeenCalled();
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.stage).toBe("completed");
    expect(last?.rankedItems).toEqual([]);
    expect(last?.completedAt).not.toBeNull();
    expect(result).toEqual({ rankedCount: 0 });

    const emptyLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "empty_shortlist",
    );
    expect(emptyLog).toBeDefined();
    expect((emptyLog?.[0] as { runId: string }).runId).toBe("run-1");
  });

  // REQ-067/REQ-090/REQ-091: Redis final write contains ONLY rankedItems (no shortlistBreakdowns leakage)
  it("REQ-067/REQ-090/REQ-091: final run-state write persists rankedItems but NOT shortlistBreakdowns", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankedItems: RankedItemRef[] = [
      { rawItemId: 1, score: 0.9, rationale: "top" },
      { rawItemId: 2, score: 0.5, rationale: "ok" },
    ];
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems,
          candidateCount: 2,
          rankedCount: 2,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    await worker.handler(baseJob);

    const last = runStateMock.updates.at(-1);
    expect(last).toBeDefined();
    expect(last?.rankedItems).toEqual(rankedItems);
    // Wire shape guard: RunState must not grow a shortlistBreakdowns field.
    expect(last).not.toHaveProperty("shortlistBreakdowns");
    const json = JSON.stringify(last);
    expect(json).not.toContain("shortlistBreakdowns");
  });

  // REQ-022: recap data written to DB after ranking
  it("REQ-022: calls updateRecapData with recap fields from ranked items after ranking", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankedItems: RankedItemRef[] = [
      {
        rawItemId: 1,
        score: 0.9,
        rationale: "top",
        summary: "Item one summary for testing purposes.",
        bullets: [
          "First bullet point with enough detail.",
          "Second bullet point with analysis.",
          "Third bullet point with takeaway.",
        ],
        bottomLine: "Strategic takeaway for item one.",
      },
      {
        rawItemId: 2,
        score: 0.5,
        rationale: "ok",
        summary: "Item two summary for testing purposes.",
        bullets: [
          "First bullet for item two analysis.",
          "Second bullet for item two details.",
          "Third bullet for item two impact.",
        ],
        bottomLine: "Strategic takeaway for item two.",
      },
    ];
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems,
          candidateCount: 2,
          rankedCount: 2,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    await worker.handler(baseJob);

    expect(mockUpdateRecapData).toHaveBeenCalledOnce();
    const updates = mockUpdateRecapData.mock.calls[0][0] as {
      id: number;
      recap: { summary: string; bullets: string[]; bottomLine: string };
    }[];
    expect(updates).toHaveLength(2);
    expect(updates[0].id).toBe(1);
    expect(updates[0].recap.summary).toBe("Item one summary for testing purposes.");
    expect(updates[0].recap.bullets).toHaveLength(3);
    expect(updates[0].recap.bottomLine).toBe("Strategic takeaway for item one.");
    expect(updates[1].id).toBe(2);
  });

  // REQ-002: archive repo is called on successful completion
  it("REQ-002: calls archiveRepo.upsert with correct args on successful completion", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankedItems: RankedItemRef[] = [
      { rawItemId: 1, score: 0.9, rationale: "top" },
      { rawItemId: 2, score: 0.5, rationale: "ok" },
    ];
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems,
          candidateCount: 2,
          rankedCount: 2,
        }),
    );
    const archiveUpsert = vi.fn(() => Promise.resolve());
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
      archiveRepo: { upsert: archiveUpsert },
    });

    await worker.handler(baseJob);

    expect(archiveUpsert).toHaveBeenCalledOnce();
    const arg = archiveUpsert.mock.calls[0]?.[0] as {
      id: string;
      status: string;
      rankedItems: RankedItemRef[];
      topN: number;
      completedAt: Date;
    };
    expect(arg.id).toBe("run-1");
    expect(arg.status).toBe("completed");
    expect(arg.rankedItems).toEqual(rankedItems);
    expect(arg.topN).toBe(3);
    expect(arg.completedAt).toBeInstanceOf(Date);
  });

  // EDGE-001: archive write failure does not crash the worker
  it("EDGE-001: logs error and completes successfully when archiveRepo.upsert throws", async () => {
    mockLoggerError.mockClear();
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
          candidateCount: 1,
          rankedCount: 1,
        }),
    );
    const archiveUpsert = vi.fn(() =>
      Promise.reject(new Error("pg connection lost")),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
      archiveRepo: { upsert: archiveUpsert },
    });

    const result = await worker.handler(baseJob);

    // Worker still completes successfully
    expect(result).toEqual({ rankedCount: 1 });
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");

    // Error was logged
    const archiveErrorLog = mockLoggerError.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "archive.write_failed",
    );
    expect(archiveErrorLog).toBeDefined();
    const payload = archiveErrorLog?.[0] as {
      event: string;
      runId: string;
      error: string;
    };
    expect(payload.runId).toBe("run-1");
    expect(payload.error).toBe("pg connection lost");
  });

  // REQ-002: factory falls back to default archiveRepo when none is injected
  it("REQ-002: uses default archiveRepo when none is provided", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
          candidateCount: 1,
          rankedCount: 1,
        }),
    );
    // No archiveRepo injected — factory creates one from the default DB connection
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    const result = await worker.handler(baseJob);
    expect(result).toEqual({ rankedCount: 1 });
  });

  // REQ-100: halfLifeHours from payload flows through to shortlist and rank options
  it("REQ-100: halfLifeHours payload propagates to shortlistFn and rankFn options", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [],
          candidateCount: 1,
          rankedCount: 0,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      shortlistFn,
      rankFn,
    });

    await worker.handler({
      ...baseJob,
      data: { ...baseJob.data, halfLifeHours: 48 },
    });

    const [, sOpts] = shortlistFn.mock.calls[0] ?? [];
    expect(sOpts?.halfLifeHours).toBe(48);
    const [, rOpts] = rankFn.mock.calls[0] ?? [];
    expect(rOpts?.halfLifeHours).toBe(48);
  });

  // REQ-032: collectTwitter is invoked exactly once when payload.twitter is present
  it("REQ-032: invokes collectTwitter exactly once when payload.twitter is present", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const twitter = vi.fn(
      (): Promise<CollectorResult> =>
        Promise.resolve({
          itemsFetched: 4,
          itemsStored: 4,
          failures: 0,
          durationMs: 1,
        }),
    );
    const stubClient: TwitterClient = {
      fetchListTweets: vi.fn(() =>
        Promise.resolve({ tweets: [], nextCursor: null }),
      ),
      fetchUserTimeline: vi.fn(() =>
        Promise.resolve({ tweets: [], nextCursor: null }),
      ),
    };
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn: vi.fn(), reddit: vi.fn(), web: vi.fn(), twitter },
      twitterClient: stubClient,
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["twitter"],
        collectors: {
          twitter: {
            listIds: ["12345"],
            users: [],
          } as unknown as TwitterCollectConfig,
        },
      },
    });

    expect(twitter).toHaveBeenCalledOnce();
    const [deps, config] = twitter.mock.calls[0] ?? [];
    expect((deps as { client: TwitterClient }).client).toBe(stubClient);
    expect((config as TwitterCollectConfig).listIds).toEqual(["12345"]);
  });

  // REQ-033: collectTwitter is NOT invoked when payload.twitter is undefined
  it("REQ-033: does not invoke collectTwitter when payload.twitter is undefined", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const twitter = vi.fn(
      (): Promise<CollectorResult> =>
        Promise.reject(new Error("should not be called")),
    );
    const hn = vi.fn(
      (): Promise<CollectorResult> =>
        Promise.resolve({
          itemsFetched: 1,
          itemsStored: 1,
          failures: 0,
          durationMs: 1,
        }),
    );
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn, reddit: vi.fn(), web: vi.fn(), twitter },
    });

    await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn"],
        collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
      },
    });

    expect(twitter).not.toHaveBeenCalled();
    expect(hn).toHaveBeenCalledOnce();
  });
});

// ---- Cancellation tests (REQ-05 through REQ-09, EDGE-03/04/05) ----

function makeNoopArchiveRepo() {
  return { upsert: vi.fn(() => Promise.resolve()) };
}

function makeInstantCancelSubscriber(triggerImmediately = false): {
  factory: CancelSubscriberFactory;
  closeSpy: ReturnType<typeof vi.fn>;
  triggerCancel: () => void;
} {
  let savedOnCancel: (() => void) | null = null;
  const closeSpy = vi.fn(() => Promise.resolve());
  const factory: CancelSubscriberFactory = {
    subscribe: vi.fn((_runId: string, onCancel: () => void) => {
      savedOnCancel = onCancel;
      if (triggerImmediately) onCancel();
      return Promise.resolve({ close: closeSpy });
    }),
  };
  return {
    factory,
    closeSpy,
    triggerCancel: () => { savedOnCancel?.(); },
  };
}

describe("run-process cancellation (REQ-05 through REQ-09)", () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  // REQ-08 + EDGE-03: cancel fires during collecting stage
  it("cancel during collecting → status 'cancelled', archive written, no rethrow", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const archiveRepo = makeNoopArchiveRepo();
    const { factory, triggerCancel } = makeInstantCancelSubscriber();

    const hnFn = vi.fn(() => {
      // Signal cancel after collector starts
      triggerCancel();
      return Promise.resolve({
        itemsFetched: 0,
        itemsStored: 0,
        failures: 0,
        durationMs: 1,
      });
    });

    const loadFn = vi.fn(() => Promise.resolve([]));
    const rankFn = vi.fn();

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      collectFns: { hn: hnFn, reddit: vi.fn(), web: vi.fn() },
      archiveRepo,
      cancelSubscriber: factory,
    });

    const result = await worker.handler({
      ...baseJob,
      data: {
        ...baseJob.data,
        sourceTypes: ["hn"],
        collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
      },
    });

    expect(result).toEqual({ rankedCount: 0 });

    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("cancelled");
    expect(last?.stage).toBe("cancelled");
    expect(last?.error).toBe("Cancelled by user");

    expect(archiveRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(rankFn).not.toHaveBeenCalled();
  });

  // REQ-08 + EDGE-03: cancel fires during shortlisting stage
  it("cancel during shortlisting → status 'cancelled', archive written, no rethrow", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const archiveRepo = makeNoopArchiveRepo();
    const { factory, triggerCancel } = makeInstantCancelSubscriber();
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));

    const shortlistFn = vi.fn(
      (cands: Candidate[]): Promise<ShortlistResult> => {
        triggerCancel();
        return Promise.resolve({ shortlist: cands, breakdowns: [] });
      },
    );
    const rankFn = vi.fn();

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn,
      archiveRepo,
      cancelSubscriber: factory,
    });

    const result = await worker.handler(baseJob);

    expect(result).toEqual({ rankedCount: 0 });
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("cancelled");
    expect(archiveRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(rankFn).not.toHaveBeenCalled();
  });

  // REQ-08 + EDGE-03: cancel fires during ranking stage
  it("cancel during ranking → status 'cancelled', archive written, no rethrow", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const archiveRepo = makeNoopArchiveRepo();
    const { factory, triggerCancel } = makeInstantCancelSubscriber();
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));

    const rankFn = vi.fn((): Promise<RankResult> => {
      triggerCancel();
      // Throw a CancelledError (extends Error) to simulate cancel during rank
      const err: Error = new CancelledError("run-1");
      return Promise.reject(err);
    });

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      archiveRepo,
      cancelSubscriber: factory,
    });

    const result = await worker.handler(baseJob);

    expect(result).toEqual({ rankedCount: 0 });
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("cancelled");
    expect(archiveRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  // EDGE-04: Redis status already "cancelling" when subscriber attaches
  it("EDGE-04: already cancelling at subscribe time → aborts without pubsub message", async () => {
    const runStateMock = makeMockRunState(
      makeRunState({ status: "cancelling" }),
    );
    const archiveRepo = makeNoopArchiveRepo();
    // Subscriber that never fires onCancel via pubsub — relies on EDGE-04 re-check
    const closeSpy = vi.fn(() => Promise.resolve());
    const factory: CancelSubscriberFactory = {
      subscribe: vi.fn((_runId: string, _onCancel: () => void) =>
        Promise.resolve({ close: closeSpy }),
      ),
    };

    const loadFn = vi.fn(() => Promise.resolve([]));
    const rankFn = vi.fn();

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      archiveRepo,
      cancelSubscriber: factory,
    });

    const result = await worker.handler(baseJob);

    expect(result).toEqual({ rankedCount: 0 });
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("cancelled");
    expect(loadFn).not.toHaveBeenCalled();
  });

  // REQ-09: subscriber.close() called in success path
  it("REQ-09: subscriber.close() is called in the success path", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const archiveRepo = makeNoopArchiveRepo();
    const closeSpy = vi.fn(() => Promise.resolve());
    const factory: CancelSubscriberFactory = {
      subscribe: vi.fn(() => Promise.resolve({ close: closeSpy })),
    };

    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));
    const rankFn = vi.fn(() =>
      Promise.resolve({
        rankedItems: [{ rawItemId: 1, score: 1, rationale: "Novelty" }],
        candidateCount: 1,
        rankedCount: 1,
      }),
    );

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      archiveRepo,
      cancelSubscriber: factory,
    });

    await worker.handler(baseJob);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  // REQ-012: archiveRepo.upsert called with startedAt and sourceTypes on successful completion
  it("REQ-012: archiveRepo.upsert receives startedAt from run-state and sourceTypes from job on success", async () => {
    const startedAt = "2026-04-07T10:00:00.000Z";
    const runStateMock = makeMockRunState(makeRunState({ startedAt }));
    const archiveRepo = makeNoopArchiveRepo();
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "top" }],
          candidateCount: 2,
          rankedCount: 1,
        }),
    );

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      archiveRepo,
    });

    await worker.handler({
      ...baseJob,
      data: { ...baseJob.data, sourceTypes: ["hn", "reddit"] },
    });

    expect(archiveRepo.upsert).toHaveBeenCalledOnce();
    const arg = archiveRepo.upsert.mock.calls[0]?.[0] as {
      startedAt: Date;
      sourceTypes: string[];
      status: string;
    };
    expect(arg.startedAt).toBeInstanceOf(Date);
    expect(arg.startedAt.toISOString()).toBe(startedAt);
    expect(arg.sourceTypes).toEqual(["hn", "reddit"]);
    expect(arg.status).toBe("completed");
  });

  // REQ-012: archiveRepo.upsert called with startedAt and sourceTypes on cancellation
  it("REQ-012: archiveRepo.upsert receives startedAt and sourceTypes on cancellation", async () => {
    const startedAt = "2026-04-07T10:00:00.000Z";
    const runStateMock = makeMockRunState(makeRunState({ startedAt }));
    const archiveRepo = makeNoopArchiveRepo();
    const { factory, triggerCancel } = makeInstantCancelSubscriber();
    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));
    const rankFn = vi.fn((): Promise<RankResult> => {
      triggerCancel();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- CancelledError is an Error subclass; lint doesn't detect it through generics
      return Promise.reject(new CancelledError("run-1"));
    });

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      archiveRepo,
      cancelSubscriber: factory,
    });

    await worker.handler({
      ...baseJob,
      data: { ...baseJob.data, sourceTypes: ["hn"] },
    });

    expect(archiveRepo.upsert).toHaveBeenCalledOnce();
    const arg = archiveRepo.upsert.mock.calls[0]?.[0] as {
      startedAt: Date;
      sourceTypes: string[];
      status: string;
    };
    expect(arg.status).toBe("cancelled");
    expect(arg.startedAt).toBeInstanceOf(Date);
    expect(arg.startedAt.toISOString()).toBe(startedAt);
    expect(arg.sourceTypes).toEqual(["hn"]);
  });

  // REQ-09: subscriber.close() called even when rank throws (non-cancel error)
  it("REQ-09: subscriber.close() is called even when rank throws a non-cancel error", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const archiveRepo = makeNoopArchiveRepo();
    const closeSpy = vi.fn(() => Promise.resolve());
    const factory: CancelSubscriberFactory = {
      subscribe: vi.fn(() => Promise.resolve({ close: closeSpy })),
    };

    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn(() => Promise.resolve(candidates));
    const rankFn = vi.fn(() => Promise.reject(new Error("boom")));

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
      shortlistFn: makeShortlistFn(passthroughShortlist),
      archiveRepo,
      cancelSubscriber: factory,
    });

    await expect(worker.handler(baseJob)).rejects.toThrow("boom");
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
