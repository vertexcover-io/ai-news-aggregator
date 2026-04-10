import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState, UserProfile } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  ProfileNotFoundError,
  ProfileParseError,
} from "@api/services/profiles.js";

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

function makeRepo(rows: RawItemRow[] = []): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve(rows)),
  };
}

function makeApp(opts: {
  redis: MockRedis;
  q: ReturnType<typeof makeQueue>;
  repo?: RawItemsRepo;
  loadProfile?: (name: string) => Promise<UserProfile>;
}): Hono {
  const app = new Hono();
  const router = createRunsRouter({
    redis: opts.redis as unknown as IORedis,
    processingQueue: opts.q.queue as unknown as Queue,
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
    loadProfile: opts.loadProfile,
  });
  app.route("/api/runs", router);
  return app;
}

describe("POST /api/runs", () => {
  it("REQ-001: returns 201 + runId for a valid payload", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("REQ-002: returns 400 when topN is 0", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 0, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: returns 400 when topN is 51", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 51, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-002: returns 400 when no source group is provided", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a payload with web only and enqueues a web-collect child", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 5,
        web: {
          sources: [
            { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
          ],
          maxItems: 3,
          sinceDays: 7,
        },
      }),
    });
    expect(res.status).toBe(201);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("run-process");
    const data = q.calls[0].data as {
      sourceTypes: string[];
      collectors: { web?: unknown };
    };
    expect(data.sourceTypes).toEqual(["blog"]);
    expect(data.collectors.web).toMatchObject({ maxItems: 3, sinceDays: 7 });
  });

  it("REQ-004: seeds Redis run-state with status running, stage queued, TTL ~3600", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  it("REQ-005: enqueues a single run-process job whose collectors carry hn and reddit configs", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
      }),
    });
    expect(q.calls).toHaveLength(1);
    const call = q.calls[0];
    expect(call.name).toBe("run-process");
    const data = call.data as {
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(data.sourceTypes.sort()).toEqual(["hn", "reddit"]);
    expect(Object.keys(data.collectors).sort()).toEqual(["hn", "reddit"]);
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
      processingQueue: makeQueue().queue as unknown as Queue,
      getRawItemsRepo: () => makeRepo(),
      logger: fakeLogger as unknown as Parameters<
        typeof createRunsRouter
      >[0]["logger"],
    });
    const app = new Hono();
    app.route("/api/runs", router);

    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    const matched = infoCalls.find(
      (call) => call.ctx.event === "run.started" && call.ctx.runId === runId,
    );
    expect(matched).toBeDefined();
  });

  it("REQ-001/REQ-002: passes parsed profile into the enqueued job when profileName is set", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const profile: UserProfile = {
      name: "alice",
      topics: ["llm", "agents"],
      antiTopics: ["crypto"],
    };
    const loadProfile = vi.fn().mockResolvedValue(profile);
    const app = makeApp({ redis, q, loadProfile });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        profileName: "alice",
      }),
    });
    expect(res.status).toBe(201);
    expect(loadProfile).toHaveBeenCalledWith("alice");
    expect(q.calls).toHaveLength(1);
    const data = q.calls[0].data as { profile: UserProfile | null };
    expect(data.profile).toEqual(profile);
  });

  it("REQ-005: enqueued job has profile: null when profileName is omitted", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 10, hn: { sinceDays: 1 } }),
    });
    expect(res.status).toBe(201);
    const data = q.calls[0].data as { profile: UserProfile | null };
    expect(data.profile).toBeNull();
  });

  it("REQ-005: enqueued job has profile: null when profileName is explicit null", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const loadProfile = vi.fn();
    const app = makeApp({ redis, q, loadProfile });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        profileName: null,
      }),
    });
    expect(res.status).toBe(201);
    expect(loadProfile).not.toHaveBeenCalled();
    const data = q.calls[0].data as { profile: UserProfile | null };
    expect(data.profile).toBeNull();
  });

  it("REQ-003/EDGE-008: returns 400 with exact message for unknown profile name", async () => {
    const loadProfile = vi
      .fn()
      .mockRejectedValue(new ProfileNotFoundError("ghost"));
    const app = makeApp({
      redis: makeRedis(),
      q: makeQueue(),
      loadProfile,
    });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        profileName: "ghost",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "profile not found: ghost" });
  });

  it("REQ-004/EDGE-009: returns 400 with structured error for malformed profile, no absolute paths in body", async () => {
    const loadProfile = vi
      .fn()
      .mockRejectedValue(
        new ProfileParseError("malformed", "yaml parse error: unexpected token"),
      );
    const app = makeApp({
      redis: makeRedis(),
      q: makeQueue(),
      loadProfile,
    });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        profileName: "malformed",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("malformed");
    expect(body.error).not.toMatch(/^\//);
    expect(body.error).not.toContain("/home/");
    expect(body.error).not.toContain("/tmp/");
  });

  it("EDGE-013: returns 400 for halfLifeHours: 0", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        halfLifeHours: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("EDGE-013: returns 400 for halfLifeHours: -5", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        halfLifeHours: -5,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("passes halfLifeHours: 24 through to enqueued job payload", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const app = makeApp({ redis, q });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topN: 10,
        hn: { sinceDays: 1 },
        halfLifeHours: 24,
      }),
    });
    expect(res.status).toBe(201);
    const data = q.calls[0].data as { halfLifeHours?: number };
    expect(data.halfLifeHours).toBe(24);
  });

  it("EDGE-011: returns 400 for malformed JSON body", async () => {
    const app = makeApp({ redis: makeRedis(), q: makeQueue() });
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const app = makeApp({ redis, q: makeQueue() });
    const res = await app.request(`/api/runs/${state.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState;
    expect(body.id).toBe(state.id);
    expect(body.status).toBe("running");
  });

  it("REQ-011: returns 404 for an unknown runId", async () => {
    const redis = makeRedis();
    const app = makeApp({ redis, q: makeQueue() });
    const res = await app.request("/api/runs/does-not-exist");
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

    const repo = makeRepo([
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

    const app = makeApp({ redis, q: makeQueue(), repo });
    const res = await app.request(`/api/runs/${completedState.id}`);
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
    const app = makeApp({ redis, q: makeQueue() });
    const res = await app.request(`/api/runs/${completedState.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rankedItems: unknown[] };
    expect(body.rankedItems).toEqual([]);
  });

  it("EDGE-012: returns 404 for path traversal attempts", async () => {
    const redis = makeRedis();
    const app = makeApp({ redis, q: makeQueue() });
    const res = await app.request("/api/runs/..%2Fetc%2Fpasswd");
    expect(res.status).toBe(404);
  });
});
