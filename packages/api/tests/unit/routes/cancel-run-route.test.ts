import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState } from "@newsletter/shared";
import { runKey } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  RunArchivesRepo,
  RunArchiveRow,
} from "@api/repositories/run-archives.js";

interface MockRedis {
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
}

function makeRedis(initial: Record<string, string> = {}): MockRedis {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    publish: vi.fn(() => Promise.resolve(1)),
  };
}

function makeQueue() {
  const add = vi.fn(
    (_name: string, _data: unknown, opts?: JobsOptions) =>
      Promise.resolve({ id: opts?.jobId ?? "job" }),
  );
  return { add, queue: { add, name: "processing" } };
}

function makeRawItemsRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
}

function makeArchiveRepo(row: RunArchiveRow | null = null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.reject(new Error("n/a"))),
  };
}

function seededRunState(overrides: Partial<RunState> = {}): RunState {
  const now = new Date().toISOString();
  return {
    id: "run-xyz",
    status: "running",
    stage: "collecting",
    topN: 10,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function buildApp(opts: {
  redis: MockRedis;
  archiveRow?: RunArchiveRow | null;
}): Hono {
  const q = makeQueue();
  const app = new Hono();
  app.route(
    "/api/runs",
    createRunsRouter({
      redis: opts.redis as unknown as IORedis,
      processingQueue: q.queue as unknown as Queue,
      getRawItemsRepo: () => makeRawItemsRepo(),
      getArchiveRepo: () => makeArchiveRepo(opts.archiveRow ?? null),
    }),
  );
  return app;
}

describe("POST /api/runs/:runId/cancel", () => {
  it("REQ-02: returns 200 with { run: RunState } when run is in 'running' status", async () => {
    const runId = "run-xyz";
    const state = seededRunState({ id: runId });
    const redis = makeRedis({ [runKey(runId)]: JSON.stringify(state) });
    const app = buildApp({ redis });

    const res = await app.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunState };
    expect(body.run).toBeDefined();
    expect(body.run.status).toBe("cancelling");
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it("EDGE-01: returns 200 idempotently when run is already 'cancelling' (no re-publish)", async () => {
    const runId = "run-xyz";
    const state = seededRunState({ id: runId, status: "cancelling" });
    const redis = makeRedis({ [runKey(runId)]: JSON.stringify(state) });
    const app = buildApp({ redis });

    const res = await app.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunState };
    expect(body.run.status).toBe("cancelling");
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it.each<{ status: RunState["status"] }>([
    { status: "completed" },
    { status: "failed" },
    { status: "cancelled" },
  ])(
    "REQ-03: returns 409 with { error, status } when run is '$status'",
    async ({ status }) => {
      const runId = "run-xyz";
      const state = seededRunState({ id: runId, status });
      const redis = makeRedis({ [runKey(runId)]: JSON.stringify(state) });
      const app = buildApp({ redis });

      const res = await app.request(`/api/runs/${runId}/cancel`, {
        method: "POST",
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; status: string };
      expect(body.error).toBe("run is not cancellable");
      expect(body.status).toBe(status);
    },
  );

  it("REQ-04: returns 404 for unknown runId (no Redis key, no DB archive)", async () => {
    const redis = makeRedis();
    const app = buildApp({ redis });

    const res = await app.request("/api/runs/unknown-id/cancel", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });

  it("REQ-04: returns 409 when run is only in DB archive (terminal, no Redis key)", async () => {
    const runId = "run-xyz";
    const redis = makeRedis();
    const archiveRow: RunArchiveRow = {
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: false,
      completedAt: new Date(),
      createdAt: new Date(),
    };
    const app = buildApp({ redis, archiveRow });

    const res = await app.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
    });

    expect(res.status).toBe(409);
  });
});
