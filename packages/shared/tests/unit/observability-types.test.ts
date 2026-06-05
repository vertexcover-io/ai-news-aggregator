import { describe, expect, it } from "vitest";
import type {
  RunFunnel,
  RunLogEntry,
  RunObservability,
  RunObservabilitySource,
  RunObservabilityStage,
} from "@shared/types/index.js";

// REQ-003: RunLogEntry + RunObservability exported from @newsletter/shared/types
// (here imported via the @shared alias the test runner maps to the same module).

const liveFunnel: RunFunnel = {
  collected: 142,
  deduped: 118,
  shortlisted: 40,
  ranked: 12,
};

const errorLog: RunLogEntry = {
  id: 7,
  runId: "11111111-1111-1111-1111-111111111111",
  ts: "2026-05-25T10:00:05.000Z",
  level: "error",
  stage: "collecting",
  source: "twitter:@karpathy",
  event: "source.failed",
  message: "Twitter auth failed",
  context: {
    durationMs: 1200,
    errors: ["401 Unauthorized"],
    stack: "Error: 401\n  at fetch",
    errorClass: "auth",
    fatal: false,
    retries: 2,
  },
};

const infoLog: RunLogEntry = {
  id: 1,
  runId: "11111111-1111-1111-1111-111111111111",
  ts: "2026-05-25T10:00:00.000Z",
  level: "info",
  stage: "collecting",
  source: null,
  event: "run.started",
  message: "Run started",
  context: null,
};

const stage: RunObservabilityStage = {
  stage: "collecting",
  startedAt: "2026-05-25T10:00:00.000Z",
  endedAt: "2026-05-25T10:00:30.000Z",
  durationMs: 30000,
};

const source: RunObservabilitySource = {
  sourceType: "twitter",
  identifier: "@karpathy",
  displayName: "@karpathy",
  itemsFetched: 0,
  status: "failed",
  errors: ["401 Unauthorized"],
  retries: 2,
  durationMs: 1200,
};

const liveObservability: RunObservability = {
  run: {
    runId: "11111111-1111-1111-1111-111111111111",
    status: "running",
    stage: "collecting",
    startedAt: "2026-05-25T10:00:00.000Z",
    completedAt: null,
    isDryRun: false,
    reviewed: false,
  },
  funnel: liveFunnel,
  sources: [source],
  enrichment: {
    attempted: 50,
    ok: 40,
    failed: 5,
    skipped: 5,
    cacheHits: 10,
    avgFetchMs: 320,
    skippedReasons: { "cache-hit": 5 },
  },
  stages: [stage],
  cost: null,
  logs: [infoLog, errorLog],
  failures: [errorLog],
  live: true,
};

describe("observability types (REQ-003)", () => {
  it("derives failures as the level=error subset of logs (REQ-023 shape)", () => {
    expect(liveObservability.failures).toEqual([errorLog]);
    expect(liveObservability.failures.every((l) => l.level === "error")).toBe(true);
  });

  it("returns logs ordered by ascending id (REQ-026 shape)", () => {
    const ids = liveObservability.logs.map((l) => l.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});
