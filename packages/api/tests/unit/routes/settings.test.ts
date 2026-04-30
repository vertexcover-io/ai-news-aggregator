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

function buildApp(repo: UserSettingsRepo, queue: ReturnType<typeof makeQueue>) {
  const app = new Hono();
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => repo,
      processingQueue: queue as never,
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
