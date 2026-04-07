import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { AppDb, RunState } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import { createPasswordAuth } from "@api/middleware/auth.js";

interface MockRedis {
  store: Map<string, { value: string; ttl: number }>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
}

function makeRedis(): MockRedis {
  const store = new Map<string, { value: string; ttl: number }>();
  const set = vi.fn(
    (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, ttl });
      return Promise.resolve("OK");
    },
  );
  const get = vi.fn((key: string) =>
    Promise.resolve(store.get(key)?.value ?? null),
  );
  const ttl = vi.fn((key: string) =>
    Promise.resolve(store.get(key)?.ttl ?? -2),
  );
  return { store, set, get, ttl };
}

interface FlowAddCall {
  name: string;
  queueName: string;
  data: unknown;
  children: { name: string; queueName: string; data: unknown }[];
}

function makeFlowProducer() {
  const calls: FlowAddCall[] = [];
  const add = vi.fn((node: FlowAddCall) => {
    calls.push(node);
    return Promise.resolve({ id: "1" });
  });
  return { add, calls, producer: { add } };
}

function makeApp(opts: {
  password?: string;
  redis: MockRedis;
  flow: ReturnType<typeof makeFlowProducer>;
  db?: AppDb;
}): Hono {
  const password = opts.password ?? "test-pass";
  const app = new Hono();
  app.use("/api/runs/*", createPasswordAuth(password));
  app.use("/api/runs", createPasswordAuth(password));
  const router = createRunsRouter({
    redis: opts.redis as unknown as IORedis,
    flowProducer: opts.flow.producer as unknown as Parameters<
      typeof createRunsRouter
    >[0]["flowProducer"],
    getDb: () => opts.db ?? ({} as AppDb),
  });
  app.route("/api/runs", router);
  return app;
}

const authHeader = { Authorization: "Bearer test-pass" };

describe("POST /api/runs", () => {
  it("REQ-001: returns 201 + runId for a valid payload", async () => {
    const redis = makeRedis();
    const flow = makeFlowProducer();
    const app = makeApp({ redis, flow });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("REQ-002: returns 400 when topN is 0", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 0, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: returns 400 when topN is 51", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 51, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: returns 400 when no source group is provided", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("Web deferral: returns 400 when body.web is present", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
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
    const redis = makeRedis();
    const flow = makeFlowProducer();
    const app = makeApp({ redis, flow });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    const { runId } = (await res.json()) as { runId: string };
    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry");
    expect(entry.ttl).toBeGreaterThanOrEqual(3000);
    expect(entry.ttl).toBeLessThanOrEqual(3600);
    const state = JSON.parse(entry.value) as RunState;
    expect(state.status).toBe("running");
    expect(state.stage).toBe("queued");
  });

  it("REQ-005: enqueues parent run-process flow with one child per source", async () => {
    const redis = makeRedis();
    const flow = makeFlowProducer();
    const app = makeApp({ redis, flow });
    await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
      }),
    });
    expect(flow.calls).toHaveLength(1);
    const node = flow.calls[0];
    expect(node.name).toBe("run-process");
    expect(node.queueName).toBe("processing");
    expect(node.children).toHaveLength(2);
    for (const child of node.children) {
      expect(child.queueName).toBe("collection");
    }
    const childNames = node.children.map((c) => c.name).sort();
    expect(childNames).toEqual(["hn-collect", "reddit-collect"]);
  });

  it("REQ-006: rejects request without auth header (401)", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(401);
  });

  it("REQ-006: accepts request with correct Bearer token (201)", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
  });

  it("REQ-080: logs run.started event with runId after a successful POST", async () => {
    const infoCalls: { ctx: Record<string, unknown>; msg: string }[] = [];
    const fakeLogger = {
      info: (ctx: Record<string, unknown>, msg: string) => {
        infoCalls.push({ ctx, msg });
      },
    };
    const router = createRunsRouter({
      redis: makeRedis() as unknown as IORedis,
      flowProducer: makeFlowProducer().producer as unknown as Parameters<
        typeof createRunsRouter
      >[0]["flowProducer"],
      getDb: () => ({}) as AppDb,
      logger: fakeLogger as unknown as Parameters<
        typeof createRunsRouter
      >[0]["logger"],
    });
    const app = new Hono();
    app.use("/api/runs/*", createPasswordAuth("test-pass"));
    app.use("/api/runs", createPasswordAuth("test-pass"));
    app.route("/api/runs", router);

    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    const matched = infoCalls.find(
      (call) => call.ctx.event === "run.started" && call.ctx.runId === runId,
    );
    expect(matched).toBeDefined();
  });

  it("EDGE-011: returns 400 for malformed JSON body", async () => {
    const app = makeApp({ redis: makeRedis(), flow: makeFlowProducer() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/runs/:runId", () => {
  function seededRunState(overrides: Partial<RunState> = {}): RunState {
    const now = new Date().toISOString();
    return {
      id: "abc-123",
      status: "running",
      stage: "queued",
      topN: 10,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      sources: { hn: { status: "pending", itemsFetched: 0, errors: [] } },
      rankedItems: null,
      warnings: [],
      error: null,
      ...overrides,
    };
  }

  it("REQ-010: returns 200 with the full state for a known runId", async () => {
    const redis = makeRedis();
    const state = seededRunState();
    redis.store.set(`run:${state.id}`, { value: JSON.stringify(state), ttl: 3600 });
    const app = makeApp({ redis, flow: makeFlowProducer() });
    const res = await app.request(`/api/runs/${state.id}`, { headers: authHeader });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState;
    expect(body.id).toBe(state.id);
    expect(body.status).toBe("running");
  });

  it("REQ-011: returns 404 for an unknown runId", async () => {
    const redis = makeRedis();
    const app = makeApp({ redis, flow: makeFlowProducer() });
    const res = await app.request("/api/runs/does-not-exist", { headers: authHeader });
    expect(res.status).toBe(404);
  });

  it("REQ-012: hydrates rankedItems from raw_items on completed status", async () => {
    const redis = makeRedis();
    const completedState = seededRunState({
      id: "completed-1",
      status: "completed",
      stage: "completed",
      completedAt: new Date().toISOString(),
      rankedItems: [
        { rawItemId: 7, score: 0.9, rationale: "great" },
      ],
    });
    redis.store.set(`run:${completedState.id}`, {
      value: JSON.stringify(completedState),
      ttl: 3600,
    });

    const where = vi.fn().mockResolvedValue([
      {
        id: 7,
        sourceType: "hn",
        title: "Some title",
        url: "https://x",
        author: "alice",
        publishedAt: new Date("2026-04-01T00:00:00Z"),
        engagement: { points: 50, commentCount: 5 },
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as AppDb;

    const app = makeApp({ redis, flow: makeFlowProducer(), db });
    const res = await app.request(`/api/runs/${completedState.id}`, { headers: authHeader });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState & { rankedItems: { id: number; title: string; score: number; rationale: string }[] };
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0]).toMatchObject({
      id: 7,
      title: "Some title",
      score: 0.9,
      rationale: "great",
    });
  });

  it("REQ-013: returns empty rankedItems array when state has empty rankedItems", async () => {
    const redis = makeRedis();
    const completedState = seededRunState({
      id: "empty-1",
      status: "completed",
      stage: "completed",
      completedAt: new Date().toISOString(),
      rankedItems: [],
    });
    redis.store.set(`run:${completedState.id}`, {
      value: JSON.stringify(completedState),
      ttl: 3600,
    });
    const app = makeApp({ redis, flow: makeFlowProducer() });
    const res = await app.request(`/api/runs/${completedState.id}`, { headers: authHeader });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rankedItems: unknown[] };
    expect(body.rankedItems).toEqual([]);
  });

  it("EDGE-012: returns 404 for path traversal attempts", async () => {
    const redis = makeRedis();
    const app = makeApp({ redis, flow: makeFlowProducer() });
    const res = await app.request("/api/runs/..%2Fetc%2Fpasswd", { headers: authHeader });
    expect(res.status).toBe(404);
  });
});
