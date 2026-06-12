import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RunState,
  RankedItemRef,
  CollectorResult,
  RunLogInsert,
} from "@newsletter/shared/types";
import type { Candidate } from "@pipeline/services/candidate-loader.js";
import type { RankResult } from "@pipeline/processors/rank.js";
import type {
  ShortlistOptions,
  ShortlistResult,
} from "@pipeline/processors/shortlist.js";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
} from "@pipeline/types.js";
import type { RunArchiveUpsertInput } from "@pipeline/repositories/run-archives.js";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, handler) => ({
    handler,
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return { ...actual, getDb: vi.fn(() => ({ fake: "db" })) };
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
  createRunArchivesRepo: vi.fn(() => ({ upsert: vi.fn() })),
}));

vi.mock("@pipeline/repositories/run-logs.js", () => ({
  createRunLogRepo: vi.fn(() => ({ append: vi.fn(() => Promise.resolve()) })),
}));

vi.mock("@pipeline/repositories/user-settings.js", () => ({
  createUserSettingsRepo: vi.fn(() => ({
    get: vi.fn(() => Promise.resolve(null)),
  })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({
    subscribe: vi.fn(() =>
      Promise.resolve({ close: vi.fn(() => Promise.resolve()) }),
    ),
  })),
}));

const { createRunProcessWorker } = await import(
  "@pipeline/workers/run-process.js"
);
import type { RunLogRepo } from "@pipeline/repositories/run-logs.js";

interface CapturedLog {
  runId: string;
  entry: RunLogInsert;
}

function makeLogRepo(): { repo: RunLogRepo; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  return {
    logs,
    repo: {
      append: vi.fn((runId: string, entry: RunLogInsert) => {
        logs.push({ runId, entry });
        return Promise.resolve();
      }),
    },
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

function makeMockRunState(initial: RunState | null): RunStateService {
  const ref: { current: RunState | null } = { current: initial };
  return {
    get: vi.fn(() => Promise.resolve(ref.current)),
    set: vi.fn((s: RunState) => {
      ref.current = s;
      return Promise.resolve();
    }),
    update: vi.fn((_runId: string, mutate: (p: RunState) => RunState) => {
      if (!ref.current) return Promise.resolve(null);
      ref.current = mutate(ref.current);
      return Promise.resolve(ref.current);
    }),
    updateSource: vi.fn(() => Promise.resolve()),
    setStage: vi.fn((_runId: string, stage) => {
      if (ref.current) ref.current = { ...ref.current, stage };
      return Promise.resolve();
    }),
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

function passthroughShortlist(cands: Candidate[]): ShortlistResult {
  return { shortlist: cands, breakdowns: [] };
}

function makeShortlistFn(): (
  cands: Candidate[],
  opts: ShortlistOptions,
) => Promise<ShortlistResult> {
  return (cands) => Promise.resolve(passthroughShortlist(cands));
}

const collectorResult = (n: number): CollectorResult => ({
  itemsFetched: n,
  itemsStored: n,
  failures: 0,
  durationMs: 1,
});

function eventsOf(logs: CapturedLog[]): string[] {
  return logs.map((l) => l.entry.event);
}

function logsFor(logs: CapturedLog[], event: string): CapturedLog[] {
  return logs.filter((l) => l.entry.event === event);
}

const happyJob = {
  name: "run-process",
  id: "job-1",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["hn", "reddit"] as ("hn" | "reddit")[],
    collectors: {
      hn: { sinceDays: 1 } as unknown as HnCollectConfig,
      reddit: {
        subreddits: ["LocalLLaMA"],
        sinceDays: 1,
      } as unknown as RedditCollectConfig,
    },
  },
};

describe("run-process worker — run_logs emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REQ-010/011/012/013/014: full happy-path event sequence
  it("emits run.started, stage pairs, source.completed, three stage.result, and enrichment.summary", async () => {
    const { repo, logs } = makeLogRepo();
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [
      makeCandidate(1, "https://example.com/a"),
      makeCandidate(2, "https://example.com/a?utm_source=x"), // dup of 1
      makeCandidate(3, "https://example.com/b"),
    ];
    const ranked: RankedItemRef[] = [
      { rawItemId: 3, score: 0.9, rationale: "best" },
      { rawItemId: 1, score: 0.7, rationale: "second" },
    ];
    const worker = createRunProcessWorker({
      runState: runStateMock,
      runLogRepo: repo,
      loadFn: vi.fn(() => Promise.resolve(candidates)),
      shortlistFn: makeShortlistFn(),
      rankFn: vi.fn(
        (): Promise<RankResult> =>
          Promise.resolve({ rankedItems: ranked, candidateCount: 2, rankedCount: 2 }),
      ),
      collectFns: {
        hn: vi.fn(() => Promise.resolve(collectorResult(2))),
        reddit: vi.fn(() => Promise.resolve(collectorResult(1))),
        web: vi.fn(),
      },
    });

    await worker.handler(happyJob);

    const events = eventsOf(logs);
    expect(events).toContain("run.started");
    expect(events).toContain("enrichment.summary");
    expect(events).toContain("run.completed");

    // Two sources → two source.completed rows (EDGE-006)
    expect(logsFor(logs, "source.completed")).toHaveLength(2);

    // Three stage.result rows with correct in/out counts
    const stageResults = logsFor(logs, "stage.result");
    expect(stageResults).toHaveLength(3);
    const byStage = new Map(
      stageResults.map((l) => [l.entry.stage, l.entry.context]),
    );
    // dedup: raw 3 → deduped 2
    expect(byStage.get("processing")).toMatchObject({
      inputCount: 3,
      outputCount: 2,
    });
    // shortlist: input 2 → output 2 (passthrough)
    expect(byStage.get("shortlisting")).toMatchObject({
      inputCount: 2,
      outputCount: 2,
    });
    // rank: input 2 → output 2
    expect(byStage.get("ranking")).toMatchObject({
      inputCount: 2,
      outputCount: 2,
    });

    // stage.start/stage.end pairs exist with durationMs on each end
    const ends = logsFor(logs, "stage.end");
    expect(ends.length).toBeGreaterThanOrEqual(1);
    for (const e of ends) {
      expect(typeof e.entry.context?.durationMs).toBe("number");
    }
    expect(logsFor(logs, "stage.start").length).toBe(ends.length);
  });

  // REQ-015: run_funnel persisted at finalize via the archive upsert
  it("persists run_funnel with the four counts on the finalize upsert", async () => {
    const { repo } = makeLogRepo();
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [
      makeCandidate(1, "https://example.com/a"),
      makeCandidate(2, "https://example.com/a?utm_source=x"), // dup
      makeCandidate(3, "https://example.com/b"),
    ];
    const ranked: RankedItemRef[] = [
      { rawItemId: 3, score: 0.9, rationale: "best" },
      { rawItemId: 1, score: 0.7, rationale: "second" },
    ];
    const upsert = vi.fn((_input: RunArchiveUpsertInput) => Promise.resolve());
    const worker = createRunProcessWorker({
      runState: runStateMock,
      runLogRepo: repo,
      loadFn: vi.fn(() => Promise.resolve(candidates)),
      shortlistFn: makeShortlistFn(),
      rankFn: vi.fn(
        (): Promise<RankResult> =>
          Promise.resolve({ rankedItems: ranked, candidateCount: 2, rankedCount: 2 }),
      ),
      archiveRepo: { upsert },
      collectFns: {
        hn: vi.fn(() => Promise.resolve(collectorResult(2))),
        reddit: vi.fn(() => Promise.resolve(collectorResult(1))),
        web: vi.fn(),
      },
    });

    await worker.handler(happyJob);

    const completedCall = upsert.mock.calls.find(
      (c) => c[0].status === "completed",
    );
    expect(completedCall).toBeDefined();
    expect(completedCall?.[0].runFunnel).toEqual({
      collected: 3,
      deduped: 2,
      shortlisted: 2,
      ranked: 2,
    });
  });

  // REQ-017/EDGE-002: fatal abort emits run.failed at error level with non-empty stack
  it("emits run.failed error row with non-empty context.stack when rank throws", async () => {
    const { repo, logs } = makeLogRepo();
    const runStateMock = makeMockRunState(makeRunState());
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const worker = createRunProcessWorker({
      runState: runStateMock,
      runLogRepo: repo,
      loadFn: vi.fn(() => Promise.resolve(candidates)),
      shortlistFn: makeShortlistFn(),
      rankFn: vi.fn(
        (): Promise<RankResult> => Promise.reject(new Error("rank blew up")),
      ),
      archiveRepo: { upsert: vi.fn(() => Promise.resolve()) },
      collectFns: {
        hn: vi.fn(() => Promise.resolve(collectorResult(1))),
        reddit: vi.fn(() => Promise.resolve(collectorResult(1))),
        web: vi.fn(),
      },
    });

    await expect(worker.handler(happyJob)).rejects.toThrow("rank blew up");

    const failed = logsFor(logs, "run.failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    const row = failed[0];
    expect(row.entry.level).toBe("error");
    expect(row.entry.message).toContain("rank blew up");
    const stack = row.entry.context?.stack;
    expect(typeof stack).toBe("string");
    expect((stack ?? "").length).toBeGreaterThan(0);
    expect(row.entry.stage).toBe("ranking");
  });

  // REQ-012/EDGE-006: a failing source emits source.failed at error level with errors
  it("emits source.failed for a failing collector and source.completed for the survivor", async () => {
    const { repo, logs } = makeLogRepo();
    const runStateMock = makeMockRunState(makeRunState());
    const worker = createRunProcessWorker({
      runState: runStateMock,
      runLogRepo: repo,
      loadFn: vi.fn(() => Promise.resolve([makeCandidate(1)])),
      shortlistFn: makeShortlistFn(),
      rankFn: vi.fn(
        (): Promise<RankResult> =>
          Promise.resolve({
            rankedItems: [{ rawItemId: 1, score: 1, rationale: "ok" }],
            candidateCount: 1,
            rankedCount: 1,
          }),
      ),
      archiveRepo: { upsert: vi.fn(() => Promise.resolve()) },
      collectFns: {
        hn: vi.fn(() => Promise.resolve(collectorResult(1))),
        reddit: vi.fn(() => Promise.reject(new Error("reddit down"))),
        web: vi.fn(),
      },
    });

    await worker.handler(happyJob);

    const failedSources = logsFor(logs, "source.failed");
    expect(failedSources).toHaveLength(1);
    expect(failedSources[0].entry.level).toBe("error");
    expect(failedSources[0].entry.context?.errors).toContain("reddit down");
    expect(logsFor(logs, "source.completed")).toHaveLength(1);
  });

  // EDGE-002: all-collectors-failed path emits run.failed with a partial funnel
  it("emits run.failed and a partial funnel when all collectors fail", async () => {
    const { repo, logs } = makeLogRepo();
    const runStateMock = makeMockRunState(makeRunState());
    const upsert = vi.fn((_input: RunArchiveUpsertInput) => Promise.resolve());
    const worker = createRunProcessWorker({
      runState: runStateMock,
      runLogRepo: repo,
      loadFn: vi.fn(() => Promise.resolve([])),
      shortlistFn: makeShortlistFn(),
      rankFn: vi.fn(),
      archiveRepo: { upsert },
      collectFns: {
        hn: vi.fn(() => Promise.reject(new Error("hn down"))),
        reddit: vi.fn(() => Promise.reject(new Error("reddit down"))),
        web: vi.fn(),
      },
    });

    await worker.handler(happyJob);

    const failed = logsFor(logs, "run.failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0].entry.level).toBe("error");

    const failedUpsert = upsert.mock.calls.find((c) => c[0].status === "failed");
    expect(failedUpsert).toBeDefined();
    // collected reached 0; later stages never ran → null
    expect(failedUpsert?.[0].runFunnel).toEqual({
      collected: 0,
      deduped: null,
      shortlisted: null,
      ranked: null,
    });
  });
});
