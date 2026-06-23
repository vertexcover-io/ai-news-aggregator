/**
 * P16 (REQ-091 wiring): a run crash triggers the tenant error alerter from
 * handleRunProcessJob — both the all-collectors-failed terminal path and the
 * unhandled stage-crash path. Dry runs stay silent. The alerter itself is a
 * FAKE (no Slack, no email — see services/error-alerts.test.ts for channel
 * behavior).
 */
import { describe, it, expect, vi } from "vitest";
import type { Candidate } from "@pipeline/processors/dedup.js";
import type { RankResult } from "@pipeline/processors/rank.js";
import type { RunState, RunStateService } from "@pipeline/services/run-state.js";
import type { RunCrashAlertInput } from "@pipeline/services/error-alerts.js";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, handler: unknown) => ({
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

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
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

const { createRunProcessWorker } = await import("@pipeline/workers/run-process.js");

interface WorkerWithHandler {
  handler: (job: {
    name: string;
    id?: string;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
}

function makeRunStateService(): RunStateService {
  const ref: { current: RunState } = {
    current: {
      id: "run-1",
      status: "running",
      stage: "collecting",
      topN: 3,
      startedAt: "2026-06-11T07:00:00.000Z",
      updatedAt: "2026-06-11T07:00:00.000Z",
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    },
  };
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

function makeAlerter(): {
  calls: RunCrashAlertInput[];
  runCrashed: (input: RunCrashAlertInput) => Promise<void>;
} {
  const calls: RunCrashAlertInput[] = [];
  return {
    calls,
    runCrashed: (input) => {
      calls.push(input);
      return Promise.resolve();
    },
  };
}

function makeCandidate(id: number): Candidate {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    sourceType: "hn",
    author: "alice",
    publishedAt: new Date("2026-06-11T06:00:00.000Z"),
    engagement: { points: 10, commentCount: 1 },
  };
}

function jobData(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["hn"],
    collectors: {},
    ...over,
  };
}

describe("run crash → tenant error alert (REQ-091 wiring)", () => {
  it("stage crash calls errorAlerter.runCrashed with the run + error before rethrowing", async () => {
    const alerter = makeAlerter();
    const worker = createRunProcessWorker({
      runState: makeRunStateService(),
      loadFn: vi.fn(() => Promise.resolve([makeCandidate(1)])),
      shortlistFn: vi.fn((cands: Candidate[]) =>
        Promise.resolve({ shortlist: cands, breakdowns: [] }),
      ),
      rankFn: vi.fn((): Promise<RankResult> => Promise.reject(new Error("rank blew up"))),
      archiveRepo: { upsert: vi.fn(() => Promise.resolve()) },
      errorAlerter: alerter,
    }) as unknown as WorkerWithHandler;

    await expect(
      worker.handler({ name: "run-process", id: "j1", data: jobData() }),
    ).rejects.toThrow("rank blew up");

    expect(alerter.calls).toEqual([
      { runId: "run-1", error: "rank blew up", stage: expect.any(String) },
    ]);
  });

  it("all-collectors-failed terminal path alerts with stage 'collecting'", async () => {
    const alerter = makeAlerter();
    const worker = createRunProcessWorker({
      runState: makeRunStateService(),
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn: vi.fn(() => Promise.reject(new Error("hn boom"))) },
      archiveRepo: { upsert: vi.fn(() => Promise.resolve()) },
      errorAlerter: alerter,
    }) as unknown as WorkerWithHandler;

    await worker.handler({
      name: "run-process",
      id: "j2",
      data: jobData({ collectors: { hn: { sinceDays: 1 } } }),
    });

    expect(alerter.calls).toEqual([
      { runId: "run-1", error: expect.stringContaining("hn boom"), stage: "collecting" },
    ]);
  });

  it("dry runs never alert", async () => {
    const alerter = makeAlerter();
    const worker = createRunProcessWorker({
      runState: makeRunStateService(),
      loadFn: vi.fn(() => Promise.resolve([])),
      rankFn: vi.fn(),
      collectFns: { hn: vi.fn(() => Promise.reject(new Error("hn boom"))) },
      archiveRepo: { upsert: vi.fn(() => Promise.resolve()) },
      errorAlerter: alerter,
    }) as unknown as WorkerWithHandler;

    await worker.handler({
      name: "run-process",
      id: "j3",
      data: jobData({ collectors: { hn: { sinceDays: 1 } }, dryRun: true }),
    });

    expect(alerter.calls).toEqual([]);
  });
});
