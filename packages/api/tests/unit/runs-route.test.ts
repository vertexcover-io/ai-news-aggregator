import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState, UserSettings } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

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
}): Hono {
  const app = new Hono();
  const router = createRunsRouter({
    redis: opts.redis as unknown as IORedis,
    processingQueue: opts.q.queue as unknown as Queue,
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
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
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
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

// POST /api/runs/:runId/post/:channel
function makeEligibleArchive(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    status: "completed",
    rankedItems: [],
    topN: 10,
    reviewed: true,
    isDryRun: false,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    socialMetadata: null,
    completedAt: new Date("2026-05-26T09:00:00.000Z"),
    publishedAt: null,
    createdAt: new Date("2026-05-26T09:00:00.000Z"),
    startedAt: null,
    sourceTypes: null,
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    notificationState: null,
    costBreakdown: null,
    runFunnel: null,
    ...overrides,
  } as unknown as RunArchiveRow;
}

function makeArchiveRepo(archive: RunArchiveRow | null = null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(archive)),
    list: vi.fn(() => Promise.resolve([])),
  } as unknown as RunArchivesRepo;
}

function makeSettingsRepo(settings: Partial<UserSettings> | null): UserSettingsRepo {
  return {
    get: () => Promise.resolve(settings as UserSettings | null),
  } as unknown as UserSettingsRepo;
}

function makePostApp(opts: {
  q: ReturnType<typeof makeQueue>;
  archive: RunArchiveRow | null;
  settings?: Partial<UserSettings> | null;
}): Hono {
  const app = new Hono();
  const router = createRunsRouter({
    redis: makeRedis() as unknown as IORedis,
    processingQueue: opts.q.queue as unknown as Queue,
    getRawItemsRepo: () => makeRepo(),
    getArchiveRepo: () => makeArchiveRepo(opts.archive),
    ...(opts.settings !== undefined
      ? { getSettingsRepo: () => makeSettingsRepo(opts.settings ?? null) }
      : {}),
  });
  app.route("/api/runs", router);
  return app;
}

const VALID_RUN_ID = "11111111-2222-3333-4444-555555555555";

describe("POST /api/runs/:runId/post/:channel", () => {
  it("REQ-001: eligible reviewed completed archive → 202 + add('linkedin-post', { runId })", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive() });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toBe(VALID_RUN_ID);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("linkedin-post");
    expect((q.calls[0].data as { runId: string }).runId).toBe(VALID_RUN_ID);
  });

  it("REQ-001: twitter channel → add('twitter-post', { runId })", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive() });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/twitter`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("twitter-post");
    expect((q.calls[0].data as { runId: string }).runId).toBe(VALID_RUN_ID);
  });

  it("REQ-002: archive not found → 404, no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: null });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-004: invalid channel 'facebook' → 400, no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive() });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/facebook`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(q.calls).toHaveLength(0);
  });

  it("EDGE-006: non-UUID runId → 400, no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive() });
    const res = await app.request("/api/runs/not-a-uuid/post/linkedin", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(q.calls).toHaveLength(0);
  });

  it("EDGE-004: dry-run archive → 409 with reason 'dry_run', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive({ isDryRun: true }) });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("dry_run");
    expect(q.calls).toHaveLength(0);
  });

  it("EDGE-005: unreviewed archive → 409 with reason 'not_reviewed', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive({ reviewed: false }) });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("not_reviewed");
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-003: not-completed status → 409 with reason 'not_completed', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({ q, archive: makeEligibleArchive({ status: "failed" }) });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("not_completed");
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-003: already posted on linkedin → 409 with reason 'already_posted', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({
      q,
      archive: makeEligibleArchive({ linkedinPostedAt: new Date("2026-05-26T10:00:00.000Z") }),
    });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("already_posted");
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-003: already posted on twitter → 409 with reason 'already_posted', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({
      q,
      archive: makeEligibleArchive({ twitterPostedAt: new Date("2026-05-26T10:00:00.000Z") }),
    });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/twitter`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("already_posted");
    expect(q.calls).toHaveLength(0);
  });

  it("linkedin disabled → 409 with reason 'channel_disabled', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({
      q,
      archive: makeEligibleArchive(),
      settings: { linkedinEnabled: false, twitterPostEnabled: true },
    });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("channel_disabled");
    expect(q.calls).toHaveLength(0);
  });

  it("twitter disabled → 409 with reason 'channel_disabled', no add", async () => {
    const q = makeQueue();
    const app = makePostApp({
      q,
      archive: makeEligibleArchive(),
      settings: { linkedinEnabled: true, twitterPostEnabled: false },
    });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/twitter`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe("channel_disabled");
    expect(q.calls).toHaveLength(0);
  });

  it("enabled channel still enqueues when the other channel is disabled", async () => {
    const q = makeQueue();
    const app = makePostApp({
      q,
      archive: makeEligibleArchive(),
      settings: { linkedinEnabled: true, twitterPostEnabled: false },
    });
    const res = await app.request(`/api/runs/${VALID_RUN_ID}/post/linkedin`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("linkedin-post");
  });
});
