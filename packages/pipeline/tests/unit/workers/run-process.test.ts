import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RunState,
  RankedItemRef,
  CollectorResult,
} from "@newsletter/shared/types";
import type { UserProfile } from "@newsletter/shared";
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
  WebCollectConfig,
} from "@pipeline/types.js";
import type { NoiseFilterOptions } from "@pipeline/processors/noise.js";
import type { SemanticDedupOptions, SemanticDedupResult } from "@pipeline/processors/semantic-dedup.js";
import type { MmrItem, MmrOptions } from "@pipeline/processors/mmr.js";
import type { NoiseFn, SemanticDedupFn, MmrFn } from "@pipeline/workers/run-process.js";

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

// Mock new processors so unit tests don't call real Voyage/LLM APIs
vi.mock("@pipeline/processors/noise.js", () => ({
  filterNoise: vi.fn((candidates: readonly unknown[]) => [...candidates]),
  MIN_ENGAGEMENT: { hn: 5, reddit: 10, blog: 0 },
  NOISE_PATTERNS: [],
}));

vi.mock("@pipeline/processors/semantic-dedup.js", () => ({
  semanticDedupCandidates: vi.fn((candidates: readonly unknown[]) =>
    Promise.resolve({
      candidates: [...candidates],
      titleEmbeds: (candidates as unknown[]).map(() => []),
    }),
  ),
  SIMILARITY_THRESHOLD: 0.85,
}));

vi.mock("@pipeline/processors/mmr.js", () => ({
  mmrSelect: vi.fn((items: { ref: unknown }[]) => items.map((item) => item.ref)),
  MMR_LAMBDA: 0.7,
  SOURCE_CAP: 3,
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
    profile?: UserProfile | null;
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
      recency: 0,
      combined: 0,
    })),
    titleEmbeds: cands.map(() => []),
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
    expect(opts.profile).toBeNull();
    expect(opts.topN).toBe(9); // topN * 3 = 3 * 3 (over-select before MMR)
    expect(opts.runId).toBe("run-1");

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

  // REQ-005 + EDGE-015: profile omitted/null propagates as null through shortlist and rank
  it("REQ-005/EDGE-015: propagates null profile to shortlistFn and rankFn when omitted", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn(
      (): Promise<Candidate[]> => Promise.resolve(candidates),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
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
      shortlistFn,
      rankFn,
    });

    await worker.handler(baseJob);

    expect(shortlistFn).toHaveBeenCalledOnce();
    const [, shortlistOpts] = shortlistFn.mock.calls[0] ?? [];
    expect(shortlistOpts?.profile).toBeNull();

    expect(rankFn).toHaveBeenCalledOnce();
    const [, rankOpts] = rankFn.mock.calls[0] ?? [];
    expect(rankOpts?.profile).toBeNull();
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
            recency: 0,
            combined: 0.5,
          })),
          titleEmbeds: top20.map(() => []),
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
        Promise.resolve({ shortlist: [], breakdowns: [], titleEmbeds: [] }),
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

  // REQ-104: two concurrent workers with different profiles keep profile state isolated
  it("REQ-104: concurrent worker invocations with different profiles do not share state", async () => {
    const profileA: UserProfile = {
      name: "aman",
      topics: ["llm"],
      antiTopics: [],
    };
    const profileB: UserProfile = {
      name: "ritesh",
      topics: ["rust"],
      antiTopics: [],
    };

    const run = async (
      profile: UserProfile,
    ): Promise<{
      shortlistProfiles: (UserProfile | null)[];
      rankProfiles: (UserProfile | null)[];
    }> => {
      const runStateMock = makeMockRunState(makeRunState());
      const candidates = [makeCandidate(1)];
      const loadFn = vi.fn(
        (): Promise<Candidate[]> => Promise.resolve(candidates),
      );
      const shortlistProfiles: (UserProfile | null)[] = [];
      const rankProfiles: (UserProfile | null)[] = [];
      const shortlistFn = vi.fn(
        (cands: Candidate[], opts: ShortlistOptions): Promise<ShortlistResult> => {
          shortlistProfiles.push(opts.profile);
          return Promise.resolve(passthroughShortlist(cands));
        },
      );
      const rankFn = vi.fn(
        (_cands: Candidate[], opts: RankOptions): Promise<RankResult> => {
          rankProfiles.push(opts.profile);
          return Promise.resolve({
            rankedItems: [],
            candidateCount: 1,
            rankedCount: 0,
          });
        },
      );
      const worker = createRunProcessWorker({
        runState: runStateMock.service,
        loadFn,
        shortlistFn,
        rankFn,
      });
      await worker.handler({
        ...baseJob,
        data: { ...baseJob.data, profile },
      });
      return { shortlistProfiles, rankProfiles };
    };

    const [resA, resB] = await Promise.all([run(profileA), run(profileB)]);
    expect(resA.shortlistProfiles).toEqual([profileA]);
    expect(resA.rankProfiles).toEqual([profileA]);
    expect(resB.shortlistProfiles).toEqual([profileB]);
    expect(resB.rankProfiles).toEqual([profileB]);
  });

  // REQ-028: halfLifeHours still accepted in payload but NOT forwarded to rank/shortlist
  it("REQ-028: halfLifeHours payload accepted but silently ignored (not forwarded)", async () => {
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

    // halfLifeHours is no longer forwarded to shortlist or rank (recency moved to fusion stage)
    const [, sOpts] = shortlistFn.mock.calls[0] ?? [];
    expect((sOpts as { halfLifeHours?: number } | undefined)?.halfLifeHours).toBeUndefined();
    const [, rOpts] = rankFn.mock.calls[0] ?? [];
    expect((rOpts as { halfLifeHours?: number } | undefined)?.halfLifeHours).toBeUndefined();
  });

  // REQ-028: RunProcessJobData shape unchanged — halfLifeHours still accepted
  it("REQ-028: RunProcessJobData accepts halfLifeHours without requiring it", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      rankFn: vi.fn(),
    });

    // halfLifeHours is optional — no type error, run completes
    const result = await worker.handler({
      ...baseJob,
      data: { ...baseJob.data, halfLifeHours: 24 },
    });
    expect(result).toEqual({ rankedCount: 0 });
  });

  // Pipeline order: noiseFn → semanticDedupFn → shortlistFn → rankFn → mmrFn
  it("pipeline stages called in order: noiseFn → semanticDedupFn → shortlistFn → rankFn → mmrFn", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [
      makeCandidate(1, "https://example.com/1"),
      makeCandidate(2, "https://example.com/2"),
    ];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));

    const callOrder: string[] = [];
    const noiseFn: NoiseFn = vi.fn((cands: readonly Candidate[], _opts: NoiseFilterOptions): Candidate[] => {
      callOrder.push("noiseFn");
      return [...cands];
    });
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands: readonly Candidate[], _opts: SemanticDedupOptions): Promise<SemanticDedupResult> => {
        callOrder.push("semanticDedupFn");
        return Promise.resolve({ candidates: [...cands], titleEmbeds: cands.map(() => [1, 0]) });
      },
    );
    const shortlistFn = vi.fn(
      (cands: Candidate[], _opts: ShortlistOptions): Promise<ShortlistResult> => {
        callOrder.push("shortlistFn");
        return Promise.resolve({
          shortlist: cands,
          breakdowns: cands.map((c) => ({ id: c.id, relevance: 0, recency: 0, combined: 0 })),
          titleEmbeds: cands.map(() => [1, 0]),
        });
      },
    );
    const rankFn = vi.fn(
      (cands: Candidate[], opts: RankOptions): Promise<RankResult> => {
        callOrder.push("rankFn");
        return Promise.resolve({
          rankedItems: cands.slice(0, opts.topN).map((c, i) => ({
            rawItemId: c.id,
            score: 1 - i * 0.1,
            rationale: "test",
          })),
          candidateCount: cands.length,
          rankedCount: Math.min(cands.length, opts.topN),
        });
      },
    );
    const mmrFn: MmrFn = vi.fn((_items: MmrItem[], _opts: MmrOptions): RankedItemRef[] => {
      callOrder.push("mmrFn");
      return [{ rawItemId: 1, score: 0.9, rationale: "mmr" }];
    });

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    await worker.handler(baseJob);

    expect(callOrder).toEqual(["noiseFn", "semanticDedupFn", "shortlistFn", "rankFn", "mmrFn"]);
  });

  // EDGE-001: all candidates match noise patterns → empty result
  it("EDGE-001: all candidates filtered by noiseFn → run completes with rankedItems: []", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));
    const noiseFn: NoiseFn = vi.fn((): Candidate[] => []);
    const semanticDedupFn: SemanticDedupFn = vi.fn();
    const rankFn = vi.fn();
    const mmrFn: MmrFn = vi.fn();

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      rankFn,
      mmrFn,
    });

    const result = await worker.handler(baseJob);

    expect(noiseFn).toHaveBeenCalledOnce();
    expect(semanticDedupFn).not.toHaveBeenCalled();
    expect(rankFn).not.toHaveBeenCalled();
    expect(mmrFn).not.toHaveBeenCalled();
    const last = runStateMock.updates.at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.rankedItems).toEqual([]);
    expect(result).toEqual({ rankedCount: 0 });
  });

  // EDGE-015: empty after URL dedup → all stages short-circuit
  it("EDGE-015: empty candidates after URL dedup → rankedItems: []", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    // All same URL → dedups to 0 after... actually URL dedup keeps one representative.
    // Use loadFn returning [] to simulate empty after collection.
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
    const noiseFn: NoiseFn = vi.fn();
    const rankFn = vi.fn();
    const mmrFn: MmrFn = vi.fn();

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      rankFn,
      mmrFn,
    });

    const result = await worker.handler(baseJob);

    expect(noiseFn).not.toHaveBeenCalled();
    expect(rankFn).not.toHaveBeenCalled();
    expect(mmrFn).not.toHaveBeenCalled();
    expect(result).toEqual({ rankedCount: 0 });
    const last = runStateMock.updates.at(-1);
    expect(last?.rankedItems).toEqual([]);
  });

  // EDGE-016: single candidate propagates through all stages
  it("EDGE-016: single candidate propagates through all stages to final output", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const single = makeCandidate(42, "https://example.com/unique");
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([single]));
    const noiseFn: NoiseFn = vi.fn((cands) => [...cands]);
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands): Promise<SemanticDedupResult> =>
        Promise.resolve({ candidates: [...cands], titleEmbeds: [[1, 0]] }),
    );
    const shortlistFn = vi.fn(
      (cands: Candidate[], _opts: ShortlistOptions): Promise<ShortlistResult> =>
        Promise.resolve({
          shortlist: cands,
          breakdowns: cands.map((c) => ({ id: c.id, relevance: 1, recency: 1, combined: 1 })),
          titleEmbeds: [[1, 0]],
        }),
    );
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 42, score: 0.9, rationale: "best" }],
          candidateCount: 1,
          rankedCount: 1,
        }),
    );
    const mmrFn: MmrFn = vi.fn(
      (): RankedItemRef[] => [{ rawItemId: 42, score: 0.9, rationale: "best" }],
    );

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    const result = await worker.handler(baseJob);

    expect(noiseFn).toHaveBeenCalledOnce();
    expect(semanticDedupFn).toHaveBeenCalledOnce();
    expect(shortlistFn).toHaveBeenCalledOnce();
    expect(rankFn).toHaveBeenCalledOnce();
    expect(mmrFn).toHaveBeenCalledOnce();
    const last = runStateMock.updates.at(-1);
    expect(last?.rankedItems).toEqual([{ rawItemId: 42, score: 0.9, rationale: "best" }]);
    expect(result).toEqual({ rankedCount: 1 });
  });

  // noiseFn runId forwarded correctly
  it("noiseFn receives correct runId in options", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1)];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));
    let capturedRunId: string | undefined;
    const noiseFn: NoiseFn = vi.fn((cands, opts) => {
      capturedRunId = opts.runId;
      return [...cands];
    });
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands): Promise<SemanticDedupResult> =>
        Promise.resolve({ candidates: [...cands], titleEmbeds: cands.map(() => []) }),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({ rankedItems: [], candidateCount: 1, rankedCount: 0 }),
    );
    const mmrFn: MmrFn = vi.fn((): RankedItemRef[] => []);

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    await worker.handler(baseJob);

    expect(capturedRunId).toBe("run-1");
  });

  // semanticDedupFn titleEmbeds forwarded to shortlist (REQ-009)
  it("titleEmbeds from semanticDedupFn forwarded to shortlistFn (REQ-009)", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));
    const noiseFn: NoiseFn = vi.fn((cands) => [...cands]);
    const titleEmbedsFromDedup = [[1, 0, 0], [0, 1, 0]];
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands): Promise<SemanticDedupResult> =>
        Promise.resolve({ candidates: [...cands], titleEmbeds: titleEmbedsFromDedup }),
    );
    let capturedTitleEmbeds: number[][] | undefined;
    const shortlistFn = vi.fn(
      (cands: Candidate[], opts: ShortlistOptions): Promise<ShortlistResult> => {
        capturedTitleEmbeds = opts.titleEmbeds;
        return Promise.resolve({
          shortlist: cands,
          breakdowns: cands.map((c) => ({ id: c.id, relevance: 0, recency: 0, combined: 0 })),
          titleEmbeds: cands.map(() => []),
        });
      },
    );
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({ rankedItems: [], candidateCount: 2, rankedCount: 0 }),
    );
    const mmrFn: MmrFn = vi.fn((): RankedItemRef[] => []);

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    await worker.handler(baseJob);

    expect(capturedTitleEmbeds).toEqual(titleEmbedsFromDedup);
  });

  // shortlist titleEmbeds forwarded to MMR via rank stage (REQ-023)
  it("shortlist titleEmbeds forwarded to mmrFn aligned to rankResult items (REQ-023)", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const c1 = makeCandidate(1, "https://example.com/1");
    const c2 = makeCandidate(2, "https://example.com/2");
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([c1, c2]));
    const noiseFn: NoiseFn = vi.fn((cands) => [...cands]);
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands): Promise<SemanticDedupResult> =>
        Promise.resolve({ candidates: [...cands], titleEmbeds: cands.map(() => []) }),
    );
    const shortlistEmbeds = [[0.9, 0.1], [0.2, 0.8]];
    const shortlistFn = vi.fn(
      (cands: Candidate[], _opts: ShortlistOptions): Promise<ShortlistResult> =>
        Promise.resolve({
          shortlist: cands,
          breakdowns: cands.map((c) => ({ id: c.id, relevance: 0, recency: 0, combined: 0 })),
          titleEmbeds: shortlistEmbeds,
        }),
    );
    const ranked: RankedItemRef[] = [
      { rawItemId: 2, score: 0.8, rationale: "r2" },
      { rawItemId: 1, score: 0.7, rationale: "r1" },
    ];
    const rankFn = vi.fn(
      (): Promise<RankResult> =>
        Promise.resolve({ rankedItems: ranked, candidateCount: 2, rankedCount: 2 }),
    );
    let capturedMmrEmbeds: number[][] | undefined;
    const mmrFn: MmrFn = vi.fn((_items, opts): RankedItemRef[] => {
      capturedMmrEmbeds = opts.titleEmbeds;
      return ranked.slice(0, 1);
    });

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    await worker.handler(baseJob);

    // mmrTitleEmbeds should be aligned to mmrItems (ranked order: c2, c1)
    // c2 is at index 1 in shortlist → shortlistEmbeds[1] = [0.2, 0.8]
    // c1 is at index 0 in shortlist → shortlistEmbeds[0] = [0.9, 0.1]
    expect(capturedMmrEmbeds).toEqual([[0.2, 0.8], [0.9, 0.1]]);
  });

  // mmrFn output stored as rankedItems
  it("mmrFn output stored as rankedItems in run-state", async () => {
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve(candidates));
    const noiseFn: NoiseFn = vi.fn((cands) => [...cands]);
    const semanticDedupFn: SemanticDedupFn = vi.fn(
      (cands): Promise<SemanticDedupResult> =>
        Promise.resolve({ candidates: [...cands], titleEmbeds: cands.map(() => []) }),
    );
    const shortlistFn = vi.fn(makeShortlistFn(passthroughShortlist));
    const rankFn = vi.fn(
      (cands: Candidate[]): Promise<RankResult> =>
        Promise.resolve({
          rankedItems: cands.map((c, i) => ({
            rawItemId: c.id,
            score: 1 - i * 0.1,
            rationale: "rank",
          })),
          candidateCount: cands.length,
          rankedCount: cands.length,
        }),
    );
    const mmrOutput: RankedItemRef[] = [{ rawItemId: 2, score: 0.95, rationale: "mmr-winner" }];
    const mmrFn: MmrFn = vi.fn((): RankedItemRef[] => mmrOutput);

    const worker = createRunProcessWorker({
      runState: runStateMock.service,
      loadFn,
      noiseFn,
      semanticDedupFn,
      shortlistFn,
      rankFn,
      mmrFn,
    });

    const result = await worker.handler(baseJob);

    const last = runStateMock.updates.at(-1);
    expect(last?.rankedItems).toEqual(mmrOutput);
    expect(result).toEqual({ rankedCount: 1 });
  });
});
