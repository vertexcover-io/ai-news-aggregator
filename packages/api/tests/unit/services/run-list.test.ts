import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type IORedis from "ioredis";
import { Hono } from "hono";
import type { Queue, JobsOptions } from "bullmq";
import type { RunCostBreakdown, RunState } from "@newsletter/shared";
import { listRuns } from "@api/services/run-list.js";
import { createRunsRouter } from "@api/routes/runs.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

interface RedisEntry {
  value: string;
}

function makeRedis(entries: Map<string, RedisEntry>) {
  return {
    scanStream: (_opts: { match: string; count: number }) => {
      const ee = new EventEmitter();
      const keys = Array.from(entries.keys());
      queueMicrotask(() => {
        if (keys.length > 0) ee.emit("data", keys);
        ee.emit("end");
      });
      return ee;
    },
    mget: vi.fn((...keys: string[]) =>
      Promise.resolve(keys.map((k) => entries.get(k)?.value ?? null)),
    ),
    get: vi.fn((k: string) => Promise.resolve(entries.get(k)?.value ?? null)),
  };
}

function makeArchiveRepo(rows: RunArchiveRow[]): RunArchivesRepo {
  return {
    findById: () => Promise.resolve(null),
    list: (limit: number) => Promise.resolve(rows.slice(0, limit)),
  };
}

function runState(overrides: Partial<RunState>): RunState {
  return {
    id: "r",
    status: "running",
    stage: "queued",
    topN: 10,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

describe("listRuns", () => {
  it("merges Redis + archives", async () => {
    const redisEntries = new Map<string, RedisEntry>([
      [
        "run:active-1",
        {
          value: JSON.stringify(
            runState({
              id: "active-1",
              startedAt: "2026-04-14T10:00:00.000Z",
            }),
          ),
        },
      ],
    ]);
    const archiveRows: RunArchiveRow[] = [
      {
        id: "done-1",
        status: "completed",
        rankedItems: [{ rawItemId: 1, score: 0.5, rationale: "x" }],
        topN: 10,
        reviewed: false,
        completedAt: new Date("2026-04-13T10:00:00.000Z"),
        createdAt: new Date("2026-04-13T10:00:00.000Z"),
        isDryRun: false,
      } as unknown as RunArchiveRow,
    ];
    const result = await listRuns(10, {
      redis: makeRedis(redisEntries) as unknown as IORedis,
      archiveRepo: makeArchiveRepo(archiveRows),
    });
    expect(result).toHaveLength(2);
    expect(result[0].runId).toBe("active-1");
    expect(result[0].status).toBe("running");
    expect(result[1].runId).toBe("done-1");
    expect(result[1].status).toBe("completed");
    expect(result[1].itemCount).toBe(1);
  });

  it("archive wins on id collision", async () => {
    const redisEntries = new Map<string, RedisEntry>([
      [
        "run:same",
        {
          value: JSON.stringify(
            runState({
              id: "same",
              startedAt: "2026-04-14T10:00:00.000Z",
              status: "running",
            }),
          ),
        },
      ],
    ]);
    const archiveRows: RunArchiveRow[] = [
      {
        id: "same",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-04-14T10:00:00.000Z"),
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        isDryRun: false,
      } as unknown as RunArchiveRow,
    ];
    const result = await listRuns(10, {
      redis: makeRedis(redisEntries) as unknown as IORedis,
      archiveRepo: makeArchiveRepo(archiveRows),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("completed");
    expect(result[0].reviewed).toBe(true);
  });

  it("sorts DESC by startedAt", async () => {
    const entries = new Map<string, RedisEntry>([
      [
        "run:a",
        {
          value: JSON.stringify(
            runState({ id: "a", startedAt: "2026-04-10T00:00:00.000Z" }),
          ),
        },
      ],
      [
        "run:b",
        {
          value: JSON.stringify(
            runState({ id: "b", startedAt: "2026-04-12T00:00:00.000Z" }),
          ),
        },
      ],
      [
        "run:c",
        {
          value: JSON.stringify(
            runState({ id: "c", startedAt: "2026-04-11T00:00:00.000Z" }),
          ),
        },
      ],
    ]);
    const result = await listRuns(10, {
      redis: makeRedis(entries) as unknown as IORedis,
      archiveRepo: makeArchiveRepo([]),
    });
    expect(result.map((r) => r.runId)).toEqual(["b", "c", "a"]);
  });

  it("R-17: admin listing includes both live and dry-run archives (no public filter applied)", async () => {
    const archiveRows: RunArchiveRow[] = [
      {
        id: "live-1",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-04-14T10:00:00.000Z"),
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        isDryRun: false,
      } as unknown as RunArchiveRow,
      {
        id: "dry-1",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-04-13T10:00:00.000Z"),
        createdAt: new Date("2026-04-13T10:00:00.000Z"),
        isDryRun: true,
      } as unknown as RunArchiveRow,
    ];
    const result = await listRuns(10, {
      redis: makeRedis(new Map()) as unknown as IORedis,
      archiveRepo: makeArchiveRepo(archiveRows),
    });
    const ids = result.map((r) => r.runId).sort();
    expect(ids).toEqual(["dry-1", "live-1"]);
    const dry = result.find((r) => r.runId === "dry-1");
    const live = result.find((r) => r.runId === "live-1");
    expect(dry?.isDryRun).toBe(true);
    expect(live?.isDryRun).toBe(false);
  });

  it("enforces limit", async () => {
    const entries = new Map<string, RedisEntry>();
    for (let i = 0; i < 5; i++) {
      entries.set(`run:r${i}`, {
        value: JSON.stringify(
          runState({
            id: `r${i}`,
            startedAt: new Date(Date.UTC(2026, 3, 14, i)).toISOString(),
          }),
        ),
      });
    }
    const result = await listRuns(3, {
      redis: makeRedis(entries) as unknown as IORedis,
      archiveRepo: makeArchiveRepo([]),
    });
    expect(result).toHaveLength(3);
  });

  it("REQ-051: surfaces costBreakdown from archive rows (non-null + null)", async () => {
    const sampleBreakdown: RunCostBreakdown = {
      schemaVersion: 1,
      totalCostUsd: 0.42,
      stages: {
        rank: {
          calls: 1,
          costUsd: 0.42,
          costStatus: "ok",
          byModel: [
            {
              modelId: "claude-haiku-4-5-20251001",
              calls: 1,
              costUsd: 0.42,
              inputTokens: 1000,
              outputTokens: 200,
              cachedInputTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              reasoningTokens: 0,
            },
          ],
        },
      },
      unknownModels: [],
      generatedAt: "2026-05-19T00:00:00.000Z",
    };
    const archiveRows: RunArchiveRow[] = [
      {
        id: "with-cost",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-04-15T10:00:00.000Z"),
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        isDryRun: false,
        costBreakdown: sampleBreakdown,
      } as unknown as RunArchiveRow,
      {
        id: "pre-feature",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-04-14T10:00:00.000Z"),
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        isDryRun: false,
        costBreakdown: null,
      } as unknown as RunArchiveRow,
    ];
    const result = await listRuns(10, {
      redis: makeRedis(new Map()) as unknown as IORedis,
      archiveRepo: makeArchiveRepo(archiveRows),
    });
    const withCost = result.find((r) => r.runId === "with-cost");
    const preFeature = result.find((r) => r.runId === "pre-feature");
    expect(withCost?.costBreakdown).toEqual(sampleBreakdown);
    expect(preFeature).toBeDefined();
    expect(preFeature?.costBreakdown).toBeNull();
  });

  it("returns costBreakdown=null when the JSONB has a legacy/unknown shape (no schemaVersion)", async () => {
    // Prod has rows written by the reverted PR #162's RunCostAccumulator with
    // a completely different shape (camelCase stage keys, `totalUsdCost` not
    // `totalCostUsd`, no schemaVersion). parseRunCostBreakdown must reject
    // these and return null so the UI shows the pre-feature empty state
    // instead of crashing on `totalCostUsd.toFixed(...)`.
    const legacyBreakdown = {
      stages: {
        webListing: { model: "claude-haiku-4-5-20251001", usdCost: 0.16, callCount: 12, inputTokens: 83503, outputTokens: 14637 },
        webExtraction: { model: "claude-haiku-4-5-20251001", usdCost: 0.006, callCount: 1, inputTokens: 5568, outputTokens: 161 },
        rank: { model: "claude-sonnet-4-5-20250929", usdCost: 0, callCount: 2, inputTokens: 92720, outputTokens: 7499 },
      },
      capturedAt: "2026-05-18T13:50:44.065Z",
      totalUsdCost: 0.163061,
      totalInputTokens: 181791,
      totalOutputTokens: 22297,
    };
    const archiveRows: RunArchiveRow[] = [
      {
        id: "legacy",
        status: "completed",
        rankedItems: [],
        topN: 10,
        reviewed: true,
        completedAt: new Date("2026-05-18T13:50:44.065Z"),
        createdAt: new Date("2026-05-18T13:50:44.065Z"),
        isDryRun: false,
        costBreakdown: legacyBreakdown,
      } as unknown as RunArchiveRow,
    ];
    const result = await listRuns(10, {
      redis: makeRedis(new Map()) as unknown as IORedis,
      archiveRepo: makeArchiveRepo(archiveRows),
    });
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("legacy");
    expect(result[0].costBreakdown).toBeNull();
  });

  it("REQ-051: redis-only running entries carry costBreakdown=null", async () => {
    const redisEntries = new Map<string, RedisEntry>([
      [
        "run:live",
        {
          value: JSON.stringify(
            runState({ id: "live", startedAt: "2026-04-16T10:00:00.000Z" }),
          ),
        },
      ],
    ]);
    const result = await listRuns(10, {
      redis: makeRedis(redisEntries) as unknown as IORedis,
      archiveRepo: makeArchiveRepo([]),
    });
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("live");
    expect(result[0].costBreakdown).toBeNull();
  });
});

function makeRawItems(): RawItemsRepo {
  return { findByIds: () => Promise.resolve([]) };
}

function makeSettingsRepo(): UserSettingsRepo {
  return {
    get: () => Promise.resolve(null),
    upsert: () => {
      throw new Error("n/a");
    },
  };
}

function makeQueueStub() {
  const add = vi.fn(
    (_n: string, _d: unknown, opts?: JobsOptions) =>
      Promise.resolve({ id: opts?.jobId ?? "job" }),
  );
  return { add };
}

describe("GET /api/runs", () => {
  function buildApp() {
    const entries = new Map<string, RedisEntry>();
    const app = new Hono();
    const redis = makeRedis(entries);
    app.route(
      "/api/runs",
      createRunsRouter({
        redis: redis as unknown as IORedis,
        processingQueue: makeQueueStub() as unknown as Queue,
        getRawItemsRepo: () => makeRawItems(),
        getSettingsRepo: () => makeSettingsRepo(),
        getArchiveRepo: () => makeArchiveRepo([]),
      }),
    );
    return { app, entries };
  }

  it("REQ-040: returns { runs: RunSummary[] } with 200", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it("REQ-042/EDGE-007: limit=0 returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/runs?limit=0");
    expect(res.status).toBe(400);
  });

  it("REQ-042: limit=101 returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/runs?limit=101");
    expect(res.status).toBe(400);
  });

  it("REQ-042: limit=abc returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/runs?limit=abc");
    expect(res.status).toBe(400);
  });
});
