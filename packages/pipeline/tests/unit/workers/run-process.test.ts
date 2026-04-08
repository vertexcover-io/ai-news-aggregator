import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunState, RankedItemRef } from "@newsletter/shared/types";
import type { Candidate } from "@pipeline/services/candidate-loader.js";
import type { RankResult } from "@pipeline/processors/rank.js";
import type { RunStateService } from "@pipeline/services/run-state.js";

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

vi.mock("@newsletter/shared/db", () => ({
  getDb: vi.fn(() => ({ fake: "db" })),
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
  rawItems: {},
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
    const loadFn = vi.fn((_db, since: Date): Promise<Candidate[]> => {
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
    const loadFn = vi.fn((_db, since: Date): Promise<Candidate[]> => {
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
});
