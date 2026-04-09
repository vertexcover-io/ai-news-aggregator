import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RunState,
  RankedItemRef,
  CollectorResult,
} from "@newsletter/shared/types";
import type { Candidate } from "@pipeline/services/candidate-loader.js";
import type { RankResult } from "@pipeline/processors/rank.js";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";

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

vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ upsertItems: vi.fn() })),
}));

vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({ findSince: vi.fn() })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

const { createRunProcessWorker } = await import(
  "@pipeline/workers/run-process.js"
);

interface JobLike {
  name: string;
  id?: string;
  data: {
    runId: string;
    topN: number;
    sourceTypes: ("hn" | "reddit" | "blog")[];
    collectors: { hn?: unknown; reddit?: unknown; web?: unknown };
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
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn,
    });

    const result = await worker.handler(baseJob);

    expect(loadFn).toHaveBeenCalledOnce();
    expect(rankFn).toHaveBeenCalledOnce();
    const [rankInput, rankOpts] = rankFn.mock.calls[0] ?? [];
    expect(Array.isArray(rankInput)).toBe(true);
    // deduped from 3 → 2 (c1/c2 canonicalize to same URL, c2 has higher engagement)
    expect((rankInput as { id: number }[]).length).toBe(2);
    expect(rankOpts).toEqual({ topN: 3, runId: "run-1" });

    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.stage).toBe("completed");
    expect(last?.rankedItems).toEqual(ranked);
    expect(last?.completedAt).not.toBeNull();
    expect(result).toEqual({ rankedCount: 2 });

    // stage transitions: processing, ranking (via setStage)
    const stages = runStateMock.stageCalls.map((s) => s.stage);
    expect(stages).toContain("processing");
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

  it("throws on unknown job name", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
    });
    await expect(
      worker.handler({ ...baseJob, name: "other" }),
    ).rejects.toThrow(/unknown job/);
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
});
