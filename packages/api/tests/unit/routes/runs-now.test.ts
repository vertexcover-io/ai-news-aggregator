import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { UserSettings } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

function makeRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve("OK");
    }),
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
  };
}

function makeQueue() {
  const calls: { name: string; data: Record<string, unknown>; opts?: JobsOptions }[] = [];
  return {
    calls,
    add: vi.fn((name: string, data: Record<string, unknown>, opts?: JobsOptions) => {
      calls.push({ name, data, opts });
      return Promise.resolve({ id: opts?.jobId ?? "job" });
    }),
  };
}

function makeSettingsRepo(value: UserSettings | null): UserSettingsRepo {
  return {
    get: () => Promise.resolve(value),
    upsert: () => {
      throw new Error("not used");
    },
  };
}

function makeArchiveRepo(): RunArchivesRepo {
  return {
    findById: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
  };
}

function makeRepo(): RawItemsRepo {
  return { findByIds: () => Promise.resolve([]) };
}

function buildApp(opts: {
  settings: UserSettings | null;
}) {
  const redis = makeRedis();
  const q = makeQueue();
  const app = new Hono();
  app.route(
    "/api/runs",
    createRunsRouter({
      redis: redis as unknown as IORedis,
      processingQueue: q as unknown as Queue,
      getRawItemsRepo: () => makeRepo(),
      getSettingsRepo: () => makeSettingsRepo(opts.settings),
      getArchiveRepo: () => makeArchiveRepo(),
    }),
  );
  return { app, redis, q };
}

const baseSettings: UserSettings = {
  id: "s1",
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
  webSearchEnabled: false,
  webSearchConfig: null,
  scheduleTime: "09:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
  updatedAt: new Date().toISOString(),
};

describe("POST /api/runs/now", () => {
  it("REQ-032: returns 409 when settings are null", async () => {
    const { app } = buildApp({ settings: null });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "settings not configured" });
  });

  it("EDGE-011: returns 409 when all sources are null", async () => {
    const { app } = buildApp({
      settings: {
        ...baseSettings,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        webSearchEnabled: false,
        webSearchConfig: null,
        },
    });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "no sources enabled" });
  });

  it("ADV-1: returns 202 when only webSearch is enabled", async () => {
    const { app, q } = buildApp({
      settings: {
        ...baseSettings,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        webSearchEnabled: true,
        webSearchConfig: {
          provider: "tavily",
          queries: [{ query: "AI safety", sinceDays: 7, maxItems: 5 }],
        },
      },
    });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(202);
    expect(q.calls).toHaveLength(1);
  });

  it("REQ-031: happy path returns 202 + runId (UUID)", async () => {
    const { app, q } = buildApp({ settings: baseSettings });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("run-process");
  });

  it.each<{ name: string; init: RequestInit }>([
    { name: "empty body", init: { method: "POST" } },
    {
      name: "{ dryRun: false } body",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      },
    },
  ])(
    "Phase 2: $name → live run (dryRun field absent on job payload)",
    async ({ init }) => {
      const { app, q } = buildApp({ settings: baseSettings });
      const res = await app.request("/api/runs/now", init);
      expect(res.status).toBe(202);
      expect(q.calls).toHaveLength(1);
      expect(q.calls[0].data.dryRun).toBeUndefined();
    },
  );

  it("Phase 2: { dryRun: true } body → dry-run job payload carries dryRun: true", async () => {
    const { app, q } = buildApp({ settings: baseSettings });
    const res = await app.request("/api/runs/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(202);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].data.dryRun).toBe(true);
  });

  it("Phase 2: rejects non-boolean dryRun with 400", async () => {
    const { app, q } = buildApp({ settings: baseSettings });
    const res = await app.request("/api/runs/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: "true" }),
    });
    expect(res.status).toBe(400);
    expect(q.calls).toHaveLength(0);
  });

  it("Phase 2: rejects unknown keys with 400 (strict schema)", async () => {
    const { app, q } = buildApp({ settings: baseSettings });
    const res = await app.request("/api/runs/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: 1 }),
    });
    expect(res.status).toBe(400);
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-031: twitter-only config triggers a run (no other sources required)", async () => {
    const { app, q } = buildApp({
      settings: {
        ...baseSettings,
        hnConfig: null,
        redditConfig: null,
        webConfig: null,
        twitterEnabled: true,
        twitterConfig: {
          listIds: ["1585430245762441216"],
          users: [{ handle: "sama", userId: "1605" }],
          maxTweetsPerSource: 50,
          sinceHours: 24,
        },
      },
    });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].name).toBe("run-process");
  });
});
