/**
 * Phase 6 e2e tests: real Redis (via createRedisConnection), mocked processing Queue.
 * Verifies POST/GET /api/runs end-to-end through Hono.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Queue, JobsOptions } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type { AppDb, RunState } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";

const redis = createRedisConnection();
const seededKeys: string[] = [];

interface QueueAddCall {
  name: string;
  data: Record<string, unknown>;
  opts?: JobsOptions;
}

function makeQueue() {
  const calls: QueueAddCall[] = [];
  const add = vi.fn(
    (name: string, data: Record<string, unknown>, opts?: JobsOptions) => {
      calls.push({ name, data, opts });
      return Promise.resolve({ id: opts?.jobId ?? `job-${name}` });
    },
  );
  return { add, calls, queue: { add, name: "processing" } };
}

function buildApp(opts: {
  q: ReturnType<typeof makeQueue>;
  db?: AppDb;
}): Hono {
  const app = new Hono();
  app.route(
    "/api/runs",
    createRunsRouter({
      redis,
      processingQueue: opts.q.queue as unknown as Queue,
      getDb: () => opts.db ?? ({} as AppDb),
    }),
  );
  return app;
}

beforeAll(async () => {
  await redis.ping();
});

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  if (seededKeys.length > 0) {
    await redis.del(...seededKeys);
    seededKeys.length = 0;
  }
});

function trackRunKey(runId: string): void {
  seededKeys.push(`run:${runId}`);
}

describe("POST /api/runs (e2e)", () => {
  it("REQ-001: returns 201 + runId for a valid payload", async () => {
    const q = makeQueue();
    const app = buildApp({ q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    trackRunKey(body.runId);
  });

  it("REQ-002: rejects topN: 0", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 0, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: rejects topN: 51", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 51, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: rejects no source group", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("Web deferral: rejects when body.web is present", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        web: { urls: ["https://example.com"] },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("web sources not yet supported");
  });

  it("REQ-004: seeds Redis run-state with status running, stage queued, TTL ~3600", async () => {
    const q = makeQueue();
    const app = buildApp({ q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    const { runId } = (await res.json()) as { runId: string };
    trackRunKey(runId);
    const raw = await redis.get(`run:${runId}`);
    if (raw === null) throw new Error("expected redis state");
    const ttl = await redis.ttl(`run:${runId}`);
    expect(ttl).toBeGreaterThanOrEqual(3000);
    expect(ttl).toBeLessThanOrEqual(3600);
    const state = JSON.parse(raw) as RunState;
    expect(state.status).toBe("running");
    expect(state.stage).toBe("queued");
  });

  it("REQ-005: enqueues a single run-process job carrying both hn and reddit configs", async () => {
    const q = makeQueue();
    const app = buildApp({ q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
      }),
    });
    const { runId } = (await res.json()) as { runId: string };
    trackRunKey(runId);
    expect(q.calls).toHaveLength(1);
    const call = q.calls[0];
    expect(call.name).toBe("run-process");
    expect(call.opts?.jobId).toBe(runId);
    const data = call.data as {
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(data.sourceTypes.sort()).toEqual(["hn", "reddit"]);
    expect(Object.keys(data.collectors).sort()).toEqual(["hn", "reddit"]);
  });

  it("EDGE-011: returns 400 for malformed JSON body", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/runs/:runId (e2e)", () => {
  it("REQ-010: returns 200 with the full state for a known runId", async () => {
    const runId = "e2e-known-run";
    const state: RunState = {
      id: runId,
      status: "running",
      stage: "queued",
      topN: 10,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      sources: { hn: { status: "pending", itemsFetched: 0, errors: [] } },
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await redis.set(`run:${runId}`, JSON.stringify(state), "EX", 3600);
    seededKeys.push(`run:${runId}`);

    const app = buildApp({ q: makeQueue() });
    const res = await app.request(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState;
    expect(body.id).toBe(runId);
    expect(body.status).toBe("running");
  });

  it("REQ-011: returns 404 for an unknown runId", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs/no-such-run");
    expect(res.status).toBe(404);
  });

  it("REQ-012: hydrates rankedItems from raw_items on completed status", async () => {
    const runId = "e2e-completed-run";
    const state: RunState = {
      id: runId,
      status: "completed",
      stage: "completed",
      topN: 5,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sources: { hn: { status: "completed", itemsFetched: 1, errors: [] } },
      rankedItems: [{ rawItemId: 11, score: 0.8, rationale: "ok" }],
      warnings: [],
      error: null,
    };
    await redis.set(`run:${runId}`, JSON.stringify(state), "EX", 3600);
    seededKeys.push(`run:${runId}`);

    const where = vi.fn().mockResolvedValue([
      {
        id: 11,
        sourceType: "hn",
        title: "Hydrated title",
        url: "https://x",
        author: "bob",
        publishedAt: new Date("2026-04-01T00:00:00Z"),
        engagement: { points: 12, commentCount: 3 },
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as AppDb;

    const app = buildApp({ q: makeQueue(), db });
    const res = await app.request(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rankedItems: { id: number; title: string; score: number; rationale: string }[];
    };
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0].title).toBe("Hydrated title");
    expect(body.rankedItems[0].score).toBe(0.8);
  });

  it("REQ-013: returns empty rankedItems when state has empty rankedItems", async () => {
    const runId = "e2e-empty-ranked";
    const state: RunState = {
      id: runId,
      status: "completed",
      stage: "completed",
      topN: 5,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sources: { hn: { status: "completed", itemsFetched: 0, errors: [] } },
      rankedItems: [],
      warnings: [],
      error: null,
    };
    await redis.set(`run:${runId}`, JSON.stringify(state), "EX", 3600);
    seededKeys.push(`run:${runId}`);

    const app = buildApp({ q: makeQueue() });
    const res = await app.request(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rankedItems: unknown[] };
    expect(body.rankedItems).toEqual([]);
  });

  it("EDGE-012: returns 404 for path traversal attempts", async () => {
    const app = buildApp({ q: makeQueue() });
    const res = await app.request("/api/runs/..%2Fetc%2Fpasswd");
    expect(res.status).toBe(404);
  });
});
