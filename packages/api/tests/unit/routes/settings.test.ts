import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { createSettingsRouter } from "@api/routes/settings.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";

function makeRepo(initial: UserSettings | null = null): {
  repo: UserSettingsRepo;
  store: { current: UserSettings | null };
  upsertCalls: number;
} {
  const store = { current: initial };
  let upsertCalls = 0;
  const repo: UserSettingsRepo = {
    get: () => Promise.resolve(store.current),
    upsert: (input) => {
      upsertCalls += 1;
      const saved: UserSettings = {
        id: "00000000-0000-0000-0000-000000000001",
        topN: input.topN,
        halfLifeHours: input.halfLifeHours,
        hnConfig: input.hnConfig,
        redditConfig: input.redditConfig,
        webConfig: input.webConfig,
        twitterConfig: input.twitterConfig,
        scheduleTime: input.scheduleTime,
        scheduleTimezone: input.scheduleTimezone,
        scheduleEnabled: input.scheduleEnabled,
        updatedAt: new Date().toISOString(),
      };
      store.current = saved;
      return Promise.resolve(saved);
    },
  };
  return {
    repo,
    store,
    get upsertCalls() {
      return upsertCalls;
    },
  } as { repo: UserSettingsRepo; store: { current: UserSettings | null }; upsertCalls: number };
}

function makeQueue() {
  const upsertJobScheduler = vi.fn(() => Promise.resolve({ id: "sched" }));
  const removeJobScheduler = vi.fn(() => Promise.resolve(true));
  return { upsertJobScheduler, removeJobScheduler };
}

function buildApp(
  repo: UserSettingsRepo,
  queue: ReturnType<typeof makeQueue>,
  resolveHandles?: (
    handles: string[],
  ) => Promise<{ handle: string; userId: string }[]>,
  socialTestPostQueue?: { add: ReturnType<typeof vi.fn> },
  socialTestRedis?: { get: ReturnType<typeof vi.fn> },
  socialTokensRepo?: SocialTokensRepo,
) {
  const app = new Hono();
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => repo,
      processingQueue: queue as never,
      socialTestPostQueue,
      socialTestRedis,
      socialTokensRepo,
      resolveHandles: resolveHandles
        ? (handles) => resolveHandles(handles)
        : undefined,
      rettiwtFactory: () => ({}) as never,
    }),
  );
  return app;
}

const validBody = {
  topN: 10,
  halfLifeHours: null,
  hnConfig: { sinceDays: 1 },
  redditConfig: null,
  webConfig: null,
  twitterConfig: null,
  scheduleTime: "09:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
};

describe("GET /api/settings", () => {
  it("REQ-010: returns null when no row exists", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("REQ-010: returns the current settings when a row exists", async () => {
    const existing: UserSettings = {
      id: "id-1",
      topN: 15,
      halfLifeHours: null,
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
      twitterConfig: null,
      scheduleTime: "08:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      updatedAt: new Date().toISOString(),
    };
    const { repo } = makeRepo(existing);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.topN).toBe(15);
  });
});

describe("PUT /api/settings", () => {
  it("REQ-011: validates, persists, and returns the row", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.topN).toBe(10);
    expect(store.current).not.toBeNull();
  });

  it("REQ-012: returns 400 with issues on invalid body", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, topN: 0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("REQ-013: returns 400 when scheduleEnabled=true with no sources", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        hnConfig: null,
        redditConfig: null,
        webConfig: null,
        twitterConfig: null,
        }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-014: triggers reconciliation (enabled -> upsertJobScheduler)", async () => {
    const { repo } = makeRepo(null);
    const queue = makeQueue();
    const app = buildApp(repo, queue);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-014/REQ-022: disabled schedule removes the scheduler", async () => {
    const { repo } = makeRepo(null);
    const queue = makeQueue();
    const app = buildApp(repo, queue);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, scheduleEnabled: false }),
    });
    expect(res.status).toBe(200);
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-045b: users with userId already set → no resolver call, persisted as-is", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([] as { handle: string; userId: string }[]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: ["111"],
          users: [{ handle: "jack", userId: "12" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
    expect(store.current?.twitterConfig).toEqual({
      listIds: ["111"],
      users: [{ handle: "jack", userId: "12" }],
      maxTweetsPerSource: undefined,
      sinceHours: undefined,
    });
  });

  it("REQ-045: users missing userId → resolver called, persisted shape has both fields", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([{ handle: "jack", userId: "12" }]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [{ handle: "jack" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(["jack"]);
    expect(store.current?.twitterConfig?.users).toEqual([
      { handle: "jack", userId: "12" },
    ]);
  });

  it("REQ-045: mixed resolved+unresolved users preserve order", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn((handles: string[]) =>
      Promise.resolve(
        handles.map((h) => ({ handle: h, userId: h === "alice" ? "100" : "200" })),
      ),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [
            { handle: "jack", userId: "12" },
            { handle: "alice" },
            { handle: "bob" },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith(["alice", "bob"]);
    expect(store.current?.twitterConfig?.users).toEqual([
      { handle: "jack", userId: "12" },
      { handle: "alice", userId: "100" },
      { handle: "bob", userId: "200" },
    ]);
  });

  it("REQ-046: resolver throws not_found → 422 with failure list, settings unchanged", async () => {
    const existing: UserSettings = {
      id: "id-1",
      topN: 5,
      halfLifeHours: null,
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
      twitterConfig: null,
      scheduleTime: "08:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      updatedAt: new Date().toISOString(),
    };
    const { repo, store } = makeRepo(existing);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("ghost", "not_found");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [{ handle: "ghost" }],
        },
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      failures: { handle: string; reason: string }[];
    };
    expect(body.failures).toEqual([{ handle: "ghost", reason: "not_found" }]);
    expect(store.current).toEqual(existing);
  });

  it("REQ-047: resolver throws missing_api_key → 503, settings unchanged", async () => {
    const { repo, store } = makeRepo(null);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("jack", "missing_api_key");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
      }),
    });
    expect(res.status).toBe(503);
    expect(store.current).toBeNull();
  });

  it("resolver throws auth_failed → 503, settings unchanged", async () => {
    const { repo, store } = makeRepo(null);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("jack", "auth_failed");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
      }),
    });
    expect(res.status).toBe(503);
    expect(store.current).toBeNull();
  });

  it("REQ-023: round-trips twitterConfig (PUT then GET returns same shape)", async () => {
    const { repo } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([{ handle: "jack", userId: "12" }]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: ["111"],
          users: [{ handle: "jack", userId: "12" }],
          maxTweetsPerSource: 50,
          sinceHours: 24,
        },
      }),
    });
    expect(putRes.status).toBe(200);
    const getRes = await app.request("/api/settings");
    const body = (await getRes.json()) as UserSettings;
    expect(body.twitterConfig).toEqual({
      listIds: ["111"],
      users: [{ handle: "jack", userId: "12" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    });
  });

  it("EDGE-011: returns 400 for malformed JSON", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/settings/test-social-post", () => {
  it("REQ-050: linkedin enqueues job and returns 202 with requestId", async () => {
    const { repo } = makeRepo(null);
    const stpQueue = { add: vi.fn(() => Promise.resolve()) };
    const stpRedis = { get: vi.fn(() => Promise.resolve(null)) };
    const app = buildApp(repo, makeQueue(), undefined, stpQueue, stpRedis);
    const res = await app.request("/api/settings/test-social-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "linkedin" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { requestId: string };
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(stpQueue.add).toHaveBeenCalledOnce();
    const call = stpQueue.add.mock.calls[0];
    expect(call[0]).toBe("social-test-post");
    expect(call[1]).toEqual({ platform: "linkedin", requestId: body.requestId });
    expect(call[2]).toEqual({ jobId: `social-test-${body.requestId}` });
  });

  it("REQ-050: twitter enqueues job and returns 202", async () => {
    const { repo } = makeRepo(null);
    const stpQueue = { add: vi.fn(() => Promise.resolve()) };
    const stpRedis = { get: vi.fn(() => Promise.resolve(null)) };
    const app = buildApp(repo, makeQueue(), undefined, stpQueue, stpRedis);
    const res = await app.request("/api/settings/test-social-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "twitter" }),
    });
    expect(res.status).toBe(202);
    expect(stpQueue.add).toHaveBeenCalledOnce();
    expect(stpQueue.add.mock.calls[0][1].platform).toBe("twitter");
  });

  it("REQ-050: invalid platform returns 400", async () => {
    const { repo } = makeRepo(null);
    const stpQueue = { add: vi.fn(() => Promise.resolve()) };
    const stpRedis = { get: vi.fn(() => Promise.resolve(null)) };
    const app = buildApp(repo, makeQueue(), undefined, stpQueue, stpRedis);
    const res = await app.request("/api/settings/test-social-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "facebook" }),
    });
    expect(res.status).toBe(400);
    expect(stpQueue.add).not.toHaveBeenCalled();
  });
});

describe("GET /api/settings/test-social-post/:requestId", () => {
  it("REQ-051: returns {status:'pending'} when redis returns null", async () => {
    const { repo } = makeRepo(null);
    const stpQueue = { add: vi.fn(() => Promise.resolve()) };
    const stpRedis = { get: vi.fn(() => Promise.resolve(null)) };
    const app = buildApp(repo, makeQueue(), undefined, stpQueue, stpRedis);
    const res = await app.request("/api/settings/test-social-post/req-x");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "pending" });
    expect(stpRedis.get).toHaveBeenCalledWith("social-test:req-x");
  });

  it("REQ-051: returns parsed JSON when redis has a value", async () => {
    const { repo } = makeRepo(null);
    const stpQueue = { add: vi.fn(() => Promise.resolve()) };
    const stored = JSON.stringify({ status: "posted", permalink: "urn:li:share:9" });
    const stpRedis = { get: vi.fn(() => Promise.resolve(stored)) };
    const app = buildApp(repo, makeQueue(), undefined, stpQueue, stpRedis);
    const res = await app.request("/api/settings/test-social-post/req-y");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "posted", permalink: "urn:li:share:9" });
  });
});

describe("GET /api/settings/social-status", () => {
  it("returns configured=true for both platforms when both rows exist", async () => {
    const { repo } = makeRepo(null);
    const tokensRepo: SocialTokensRepo = {
      hasToken: vi.fn(() => Promise.resolve(true)),
    };
    const app = buildApp(
      repo,
      makeQueue(),
      undefined,
      undefined,
      undefined,
      tokensRepo,
    );
    const res = await app.request("/api/settings/social-status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      linkedin: { configured: true },
      twitter: { configured: true },
    });
  });

  it("returns configured=true only for the platform whose token row exists", async () => {
    const { repo } = makeRepo(null);
    const tokensRepo: SocialTokensRepo = {
      hasToken: vi.fn((platform) =>
        Promise.resolve(platform === "linkedin"),
      ),
    };
    const app = buildApp(
      repo,
      makeQueue(),
      undefined,
      undefined,
      undefined,
      tokensRepo,
    );
    const res = await app.request("/api/settings/social-status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      linkedin: { configured: true },
      twitter: { configured: false },
    });
  });
});
