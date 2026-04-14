import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type IORedis from "ioredis";
import { Hono } from "hono";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState } from "@newsletter/shared";
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
        profileName: null,
        reviewed: false,
        completedAt: new Date("2026-04-13T10:00:00.000Z"),
        createdAt: new Date("2026-04-13T10:00:00.000Z"),
      },
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
        profileName: null,
        reviewed: true,
        completedAt: new Date("2026-04-14T10:00:00.000Z"),
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
      },
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
