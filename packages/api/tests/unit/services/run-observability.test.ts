import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import { runKey } from "@newsletter/shared";
import type {
  RunCostBreakdown,
  RunFunnel,
  RunLogEntry,
  RunSourceTelemetry,
  RunState,
} from "@newsletter/shared";
import type { RunArchiveRow, RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { RunLogRepo } from "@api/repositories/run-logs.js";
import { buildRunObservability } from "@api/services/run-observability.js";
import { NotFoundError } from "@api/lib/errors.js";

const RUN_ID = "11111111-1111-1111-1111-111111111111";

function makeRedis(state: RunState | null): Pick<IORedis, "get"> {
  return {
    get: vi.fn((key: string) =>
      key === runKey(RUN_ID) && state !== null
        ? Promise.resolve(JSON.stringify(state))
        : Promise.resolve(null),
    ),
  } as unknown as Pick<IORedis, "get">;
}

function makeArchiveRepo(row: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
  } as unknown as RunArchivesRepo;
}

function makeLogRepo(logs: RunLogEntry[]): RunLogRepo {
  return { listForRun: vi.fn(() => Promise.resolve(logs)) };
}

function log(partial: Partial<RunLogEntry> & { id: number; event: RunLogEntry["event"] }): RunLogEntry {
  return {
    runId: RUN_ID,
    ts: "2026-05-25T00:00:00.000Z",
    level: "info",
    stage: "",
    source: null,
    message: "",
    context: null,
    ...partial,
  };
}

const liveRunState: RunState = {
  id: RUN_ID,
  status: "running",
  stage: "ranking",
  topN: 10,
  startedAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:05:00.000Z",
  completedAt: null,
  sources: {
    hn: { status: "completed", itemsFetched: 12, errors: [] },
    reddit: { status: "failed", itemsFetched: 0, errors: ["boom"] },
  },
  rankedItems: null,
  warnings: [],
  error: null,
};

const archiveTelemetry: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "news.ycombinator.com",
      displayName: "Hacker News",
      itemsFetched: 12,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 4200,
    },
    {
      sourceType: "reddit",
      identifier: "r/LocalLLaMA",
      displayName: "r/LocalLLaMA",
      itemsFetched: 0,
      status: "failed",
      errors: ["rate limited"],
      retries: 2,
      durationMs: 800,
    },
  ],
  totalItemsFetched: 12,
  totalErrors: 1,
  enrichment: {
    attempted: 5,
    ok: 4,
    failed: 1,
    skipped: 0,
    cacheHits: 2,
    avgFetchMs: 320,
    skippedReasons: {},
  },
};

const archiveCost: RunCostBreakdown = {
  schemaVersion: 1,
  totalCostUsd: 0.12,
  stages: {},
  unknownModels: [],
  generatedAt: "2026-05-25T00:06:00.000Z",
};

function makeArchiveRow(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [],
    topN: 10,
    reviewed: true,
    completedAt: new Date("2026-05-25T00:06:00.000Z"),
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    startedAt: new Date("2026-05-25T00:00:00.000Z"),
    sourceTypes: ["hn", "reddit"],
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    sourceTelemetry: archiveTelemetry,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    isDryRun: false,
    costBreakdown: archiveCost,
    runFunnel: { collected: 12, deduped: 10, shortlisted: 8, ranked: 6 },
    ...overrides,
  };
}

describe("buildRunObservability", () => {
  const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("test_REQ_013_observability_tenant_fence: another tenant's live state reads as not-found", async () => {
    await expect(
      buildRunObservability(RUN_ID, {
        redis: makeRedis({ ...liveRunState, tenantId: TENANT_B }),
        archiveRepo: makeArchiveRepo(null),
        runLogRepo: makeLogRepo([]),
        requesterScope: { tenantId: TENANT_A, role: "tenant_admin" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("test_REQ_013_observability_tenant_fence: the owning tenant still sees its live state", async () => {
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis({ ...liveRunState, tenantId: TENANT_A }),
      archiveRepo: makeArchiveRepo(null),
      runLogRepo: makeLogRepo([]),
      requesterScope: { tenantId: TENANT_A, role: "tenant_admin" },
    });
    expect(result.live).toBe(true);
    expect(result.run.status).toBe("running");
  });

  it("test_REQ_013_observability_tenant_fence: legacy states without tenantId stay readable (grandfathered)", async () => {
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(liveRunState),
      archiveRepo: makeArchiveRepo(null),
      runLogRepo: makeLogRepo([]),
      requesterScope: { tenantId: TENANT_A, role: "tenant_admin" },
    });
    expect(result.live).toBe(true);
  });

  it("REQ-024: throws NotFoundError when both run-state and archive are null", async () => {
    await expect(
      buildRunObservability(RUN_ID, {
        redis: makeRedis(null),
        archiveRepo: makeArchiveRepo(null),
        runLogRepo: makeLogRepo([]),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("EDGE-001/REQ-021: live run (run-state present, no archive) => live=true, funnel from logs, sources from run-state, logs present", async () => {
    const logs: RunLogEntry[] = [
      log({ id: 1, event: "run.started", stage: "queued", message: "run started" }),
      log({
        id: 2,
        event: "stage.result",
        stage: "processing",
        message: "dedup done",
        context: { inputCount: 12, outputCount: 10 },
      }),
      log({
        id: 3,
        event: "stage.result",
        stage: "shortlisting",
        message: "shortlist done",
        context: { inputCount: 10, outputCount: 8 },
      }),
      log({
        id: 4,
        event: "source.completed",
        stage: "collecting",
        source: "hn",
        message: "hn done",
        context: { itemsFetched: 12 },
      }),
    ];
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(liveRunState),
      archiveRepo: makeArchiveRepo(null),
      runLogRepo: makeLogRepo(logs),
    });

    expect(result.live).toBe(true);
    expect(result.run.runId).toBe(RUN_ID);
    expect(result.run.status).toBe("running");
    expect(result.run.stage).toBe("ranking");
    // funnel derived from stage.result rows; ranking not reached yet => null
    expect(result.funnel.deduped).toBe(10);
    expect(result.funnel.shortlisted).toBe(8);
    expect(result.funnel.ranked).toBeNull();
    // sources mapped from Redis run-state
    const hn = result.sources.find((s) => s.sourceType === "hn");
    expect(hn?.itemsFetched).toBe(12);
    expect(hn?.status).toBe("completed");
    const reddit = result.sources.find((s) => s.sourceType === "reddit");
    expect(reddit?.status).toBe("failed");
    expect(reddit?.errors).toEqual(["boom"]);
    // logs present even with no archive
    expect(result.logs).toHaveLength(4);
  });

  it("REQ-022/EDGE-003: historical (archive present, no run-state) => live=false, funnel from runFunnel, sources from telemetry", async () => {
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchiveRow()),
      runLogRepo: makeLogRepo([]),
    });

    expect(result.live).toBe(false);
    expect(result.run.status).toBe("completed");
    expect(result.run.reviewed).toBe(true);
    expect(result.run.completedAt).toBe("2026-05-25T00:06:00.000Z");
    // funnel from archive.runFunnel
    expect(result.funnel).toEqual<RunFunnel>({
      collected: 12,
      deduped: 10,
      shortlisted: 8,
      ranked: 6,
    });
    // sources from archive.sourceTelemetry
    expect(result.sources).toHaveLength(2);
    const reddit = result.sources.find((s) => s.sourceType === "reddit");
    expect(reddit?.identifier).toBe("r/LocalLLaMA");
    expect(reddit?.status).toBe("failed");
    expect(reddit?.retries).toBe(2);
    expect(reddit?.durationMs).toBe(800);
    // enrichment + cost from archive
    expect(result.enrichment).toEqual(archiveTelemetry.enrichment);
    expect(result.cost).toEqual(archiveCost);
  });

  it("EDGE-005: legacy archive (runFunnel null, no logs) => funnel all null, empty logs, source/cost still from archive", async () => {
    const row = makeArchiveRow({
      runFunnel: null,
      costBreakdown: archiveCost,
      sourceTelemetry: archiveTelemetry,
    });
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(row),
      runLogRepo: makeLogRepo([]),
    });

    expect(result.live).toBe(false);
    expect(result.funnel).toEqual<RunFunnel>({
      collected: null,
      deduped: null,
      shortlisted: null,
      ranked: null,
    });
    expect(result.logs).toEqual([]);
    expect(result.sources).toHaveLength(2);
    expect(result.cost).toEqual(archiveCost);
  });

  it("EDGE-005 fallback: legacy archive with runFunnel null but logs present => funnel derived from logs", async () => {
    const logs: RunLogEntry[] = [
      log({
        id: 1,
        event: "stage.result",
        stage: "processing",
        context: { inputCount: 20, outputCount: 18 },
      }),
      log({
        id: 2,
        event: "stage.result",
        stage: "ranking",
        context: { inputCount: 18, outputCount: 7 },
      }),
    ];
    const row = makeArchiveRow({ runFunnel: null });
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(row),
      runLogRepo: makeLogRepo(logs),
    });

    expect(result.funnel.deduped).toBe(18);
    expect(result.funnel.ranked).toBe(7);
  });

  it("REQ-023: failures is the subset of logs where level === error", async () => {
    const logs: RunLogEntry[] = [
      log({ id: 1, event: "stage.start", stage: "collecting", level: "info" }),
      log({
        id: 2,
        event: "source.failed",
        stage: "collecting",
        source: "twitter",
        level: "error",
        message: "auth failed",
        context: { errors: ["no cookies"] },
      }),
      log({ id: 3, event: "stage.end", stage: "collecting", level: "info" }),
      log({
        id: 4,
        event: "run.failed",
        stage: "ranking",
        level: "error",
        message: "fatal",
        context: { stack: "Error: boom\n  at x" },
      }),
    ];
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchiveRow({ status: "failed" })),
      runLogRepo: makeLogRepo(logs),
    });

    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((f) => f.level === "error")).toBe(true);
    expect(result.failures.map((f) => f.id)).toEqual([2, 4]);
  });

  it("REQ-026: logs are returned in the order the repo provides (by id asc)", async () => {
    const logs: RunLogEntry[] = [
      log({ id: 1, event: "run.started", stage: "queued" }),
      log({ id: 2, event: "stage.start", stage: "collecting" }),
      log({ id: 3, event: "stage.end", stage: "collecting" }),
    ];
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchiveRow()),
      runLogRepo: makeLogRepo(logs),
    });

    expect(result.logs.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it("derives stages from stage.start/stage.end pairs (durationMs from end row)", async () => {
    const logs: RunLogEntry[] = [
      log({
        id: 1,
        event: "stage.start",
        stage: "collecting",
        ts: "2026-05-25T00:00:00.000Z",
      }),
      log({
        id: 2,
        event: "stage.end",
        stage: "collecting",
        ts: "2026-05-25T00:00:05.000Z",
        context: { durationMs: 5000 },
      }),
    ];
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchiveRow()),
      runLogRepo: makeLogRepo(logs),
    });

    const collecting = result.stages.find((s) => s.stage === "collecting");
    expect(collecting?.startedAt).toBe("2026-05-25T00:00:00.000Z");
    expect(collecting?.endedAt).toBe("2026-05-25T00:00:05.000Z");
    expect(collecting?.durationMs).toBe(5000);
  });

  it("live run with terminal status in Redis is treated as historical (live=false)", async () => {
    const completedState: RunState = { ...liveRunState, status: "completed", stage: "completed" };
    const result = await buildRunObservability(RUN_ID, {
      redis: makeRedis(completedState),
      archiveRepo: makeArchiveRepo(makeArchiveRow()),
      runLogRepo: makeLogRepo([]),
    });
    expect(result.live).toBe(false);
  });
});
