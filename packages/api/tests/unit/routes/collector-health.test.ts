import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { HEALTH_CHECKABLE_COLLECTORS } from "@newsletter/shared";
import type { CollectorHealthSnapshot } from "@newsletter/shared/types";
import { requireAdmin } from "@api/auth/middleware.js";
import { issueToken } from "@api/auth/session.js";
import { createCollectorHealthRouter } from "@api/routes/collector-health.js";
import type { CollectorHealthRouterDeps } from "@api/routes/collector-health.js";

const SESSION_SECRET = "test-session-secret-32-chars-ok!";

function adminCookie(): string {
  const token = issueToken(SESSION_SECRET, Date.now());
  return `admin_session=${token}`;
}

function makeQueue() {
  const addCalls: { name: string; data: unknown }[] = [];
  const add = vi.fn((name: string, data: unknown) => {
    addCalls.push({ name, data });
    return Promise.resolve({ id: "job-1" });
  });
  return { add, addCalls };
}

function makeStore() {
  const setRunningCalls: { collector: string; trigger: string }[] = [];
  const setRunning = vi.fn((collector: string, trigger: string, _now: Date) => {
    setRunningCalls.push({ collector, trigger });
    return Promise.resolve();
  });

  const snapshot: CollectorHealthSnapshot = {
    collectors: HEALTH_CHECKABLE_COLLECTORS.map((c) => ({
      collector: c,
      status: "never" as const,
      trigger: null,
      checkedAt: null,
      durationMs: null,
      reason: null,
      detail: null,
    })),
  };
  const getSnapshot = vi.fn(() => Promise.resolve(snapshot));
  const set = vi.fn(() => Promise.resolve());

  return { setRunning, setRunningCalls, getSnapshot, set };
}

function baseSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "s1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { sinceDays: 1 },
    redditEnabled: true,
    redditConfig: { subreddits: ["MachineLearning"], sinceDays: 1, maxItems: 25, includeComments: false },
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
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
    rankingPrompt: "rank",
    shortlistPrompt: "shortlist",
    shortlistSize: 20,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildApp(deps: CollectorHealthRouterDeps, withAuth = false): Hono {
  const app = new Hono();
  if (withAuth) {
    app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  }
  app.route("/api/admin/collector-health", createCollectorHealthRouter(deps));
  return app;
}

describe("POST /api/admin/collector-health/check", () => {
  let queue: ReturnType<typeof makeQueue>;
  let store: ReturnType<typeof makeStore>;
  let settings: UserSettings;

  beforeEach(() => {
    queue = makeQueue();
    store = makeStore();
    settings = baseSettings();
  });

  it("REQ-001/003: POST with collector='hn' -> 202 {enqueued:['hn']}, queue.add called, store.setRunning called", async () => {
    const app = buildApp({
      collectorHealthQueue: queue as never,
      store,
      getSettings: () => Promise.resolve(settings),
    });

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collector: "hn" }),
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { enqueued: string[] };
    expect(body.enqueued).toEqual(["hn"]);
    expect(queue.add).toHaveBeenCalledWith(
      "collector-health",
      { collectors: ["hn"], trigger: "manual" },
    );
    expect(store.setRunning).toHaveBeenCalledWith("hn", "manual", expect.any(Date));
  });

  it("REQ-002: POST with no body -> targets = all enabled collectors from settings", async () => {
    // settings has hn + reddit enabled, web/twitter/webSearch disabled
    const app = buildApp({
      collectorHealthQueue: queue as never,
      store,
      getSettings: () => Promise.resolve(settings),
    });

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { enqueued: string[] };
    // hn and reddit enabled; web=false, twitter=false, web_search=false, blog=false
    expect(body.enqueued).toContain("hn");
    expect(body.enqueued).toContain("reddit");
    expect(body.enqueued).not.toContain("twitter");
    expect(body.enqueued).not.toContain("blog");
    expect(body.enqueued).not.toContain("web_search");
  });

  it("EDGE-001: all enabled=[] -> 202 {enqueued:[]}, no queue.add", async () => {
    const noEnabled = baseSettings({
      hnEnabled: false,
      redditEnabled: false,
      webEnabled: false,
      twitterEnabled: false,
      webSearchEnabled: false,
    });
    const app = buildApp({
      collectorHealthQueue: queue as never,
      store,
      getSettings: () => Promise.resolve(noEnabled),
    });

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { enqueued: string[] };
    expect(body.enqueued).toEqual([]);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("EDGE-013: explicit collector is allowed even if disabled in settings", async () => {
    const noTwitter = baseSettings({ twitterEnabled: false });
    const app = buildApp({
      collectorHealthQueue: queue as never,
      store,
      getSettings: () => Promise.resolve(noTwitter),
    });

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collector: "twitter" }),
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { enqueued: string[] };
    expect(body.enqueued).toEqual(["twitter"]);
    expect(queue.add).toHaveBeenCalledWith(
      "collector-health",
      { collectors: ["twitter"], trigger: "manual" },
    );
  });

  it("REQ-023: unauthenticated POST -> 401", async () => {
    const app = buildApp(
      {
        collectorHealthQueue: queue as never,
        store,
        getSettings: () => Promise.resolve(settings),
      },
      true, // with auth
    );

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collector: "hn" }),
    });

    expect(res.status).toBe(401);
  });

  it("REQ-023: authenticated POST returns 202", async () => {
    const app = buildApp(
      {
        collectorHealthQueue: queue as never,
        store,
        getSettings: () => Promise.resolve(settings),
      },
      true,
    );

    const res = await app.request("/api/admin/collector-health/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie(),
      },
      body: JSON.stringify({ collector: "hn" }),
    });

    expect(res.status).toBe(202);
  });
});

describe("GET /api/admin/collector-health", () => {
  let queue: ReturnType<typeof makeQueue>;
  let store: ReturnType<typeof makeStore>;
  let settings: UserSettings;

  beforeEach(() => {
    queue = makeQueue();
    store = makeStore();
    settings = baseSettings();
  });

  it("REQ-008: GET -> snapshot with length 5 (one per HEALTH_CHECKABLE_COLLECTORS)", async () => {
    const app = buildApp({
      collectorHealthQueue: queue as never,
      store,
      getSettings: () => Promise.resolve(settings),
    });

    const res = await app.request("/api/admin/collector-health");

    expect(res.status).toBe(200);
    const body = await res.json() as CollectorHealthSnapshot;
    expect(body.collectors).toHaveLength(HEALTH_CHECKABLE_COLLECTORS.length);
    expect(body.collectors).toHaveLength(5);
    // All should be "never" status from our fake store
    for (const entry of body.collectors) {
      expect(entry.status).toBe("never");
    }
  });

  it("REQ-023: unauthenticated GET -> 401", async () => {
    const app = buildApp(
      {
        collectorHealthQueue: queue as never,
        store,
        getSettings: () => Promise.resolve(settings),
      },
      true,
    );

    const res = await app.request("/api/admin/collector-health");
    expect(res.status).toBe(401);
  });

  it("REQ-023: authenticated GET returns 200", async () => {
    const app = buildApp(
      {
        collectorHealthQueue: queue as never,
        store,
        getSettings: () => Promise.resolve(settings),
      },
      true,
    );

    const res = await app.request("/api/admin/collector-health", {
      headers: { Cookie: adminCookie() },
    });

    expect(res.status).toBe(200);
  });
});
