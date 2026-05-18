import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { createSettingsRouter } from "@api/routes/settings.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

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
        hnEnabled: input.hnEnabled,
        hnConfig: input.hnConfig,
        redditEnabled: input.redditEnabled,
        redditConfig: input.redditConfig,
        webEnabled: input.webEnabled,
        webConfig: input.webConfig,
        twitterEnabled: input.twitterEnabled,
        twitterConfig: input.twitterConfig,
        posthogEnabled: input.posthogEnabled,
        posthogProjectToken: input.posthogProjectToken,
        posthogHost: input.posthogHost,
        scheduleTime: input.pipelineTime,
        pipelineTime: input.pipelineTime,
        emailTime: input.emailTime,
        linkedinTime: input.linkedinTime,
        twitterTime: input.twitterTime,
        scheduleTimezone: input.scheduleTimezone,
        scheduleEnabled: input.scheduleEnabled,
        emailEnabled: input.emailEnabled,
        linkedinEnabled: input.linkedinEnabled,
        twitterPostEnabled: input.twitterPostEnabled,
        autoReview: input.autoReview,
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
) {
  const app = new Hono();
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => repo,
      processingQueue: queue as never,
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
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "09:30",
  pipelineTime: "09:30",
  emailTime: "10:00",
  linkedinTime: "10:15",
  twitterTime: "10:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
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
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "08:00",
      pipelineTime: "08:00",
      emailTime: "08:30",
      linkedinTime: "08:45",
      twitterTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
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

  it("accepts and persists PostHog analytics config", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        posthogEnabled: true,
        posthogProjectToken: "phc_project_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.posthogEnabled).toBe(true);
    expect(body.posthogProjectToken).toBe("phc_project_token");
    expect(body.posthogHost).toBe("https://us.i.posthog.com");
    expect(store.current).toMatchObject({
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });
  });

  it("rejects invalid PostHog host URLs", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        posthogEnabled: true,
        posthogProjectToken: "phc_project_token",
        posthogHost: "not-a-url",
      }),
    });
    expect(res.status).toBe(400);
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

  it("accepts overnight publish windows where publish times are earlier than pipelineTime", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        pipelineTime: "19:00",
        scheduleTime: "19:00",
        emailTime: "09:00",
        linkedinTime: "09:15",
        twitterTime: "09:30",
      }),
    });

    expect(res.status).toBe(200);
    expect(store.current?.emailTime).toBe("09:00");
  });

  it("rejects publish times equal to pipelineTime", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        pipelineTime: "19:00",
        scheduleTime: "19:00",
        emailTime: "19:00",
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        fields: expect.arrayContaining(["emailTime"]),
        issues: expect.arrayContaining([
          expect.objectContaining({ message: "must differ from pipelineTime" }),
        ]),
      }),
    );
  });

  it("REQ-013: returns 400 when scheduleEnabled=true with no sources", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
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
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(5);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("preserves collector config when that collector is disabled", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        hnEnabled: false,
        hnConfig: { sinceDays: 3, keywords: ["agents"] },
        scheduleEnabled: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.hnEnabled).toBe(false);
    expect(body.hnConfig).toEqual({ sinceDays: 3, keywords: ["agents"] });
    expect(store.current?.hnConfig).toEqual({ sinceDays: 3, keywords: ["agents"] });
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
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(5);
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
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "08:00",
      pipelineTime: "08:00",
      emailTime: "08:30",
      linkedinTime: "08:45",
      twitterTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
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
