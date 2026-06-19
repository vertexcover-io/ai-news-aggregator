/**
 * Phase 3 e2e: real Redis, real DB for user_settings.
 * Verifies PUT -> GET round-trip and scheduler reconciliation using a mocked queue.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, sources, userSettings } from "@newsletter/shared/db";
import { createSettingsRouter } from "@api/routes/settings.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createSourcesRepo } from "@api/repositories/sources.js";
import { ensureE2eTenant } from "./helpers/tenant.js";

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

const db = getDb();
const tenantCtx = await ensureE2eTenant();

beforeAll(async () => {
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
});

afterAll(async () => {
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
});

beforeEach(async () => {
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
});

function buildApp(queue: ReturnType<typeof makeQueue>) {
  const app = new Hono();
  // Separate mock for the dedicated collector-health queue (D-110) so the
  // processing-queue scheduler-call assertions below are not affected by the
  // collector-health reconcile.
  const collectorHealthQueue = makeQueue();
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => createUserSettingsRepo(db, tenantCtx),
      processingQueue: queue as never,
      collectorHealthQueue: collectorHealthQueue as never,
    }),
  );
  return app;
}

const validBody = {
  topN: 10,
  shortlistSize: 30,
  shortlistPrompt: "Shortlist the top items by signal.",
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
  rankingPrompt: "Rank items by novelty, signal, and actionability.",
};

describe("Settings routes (e2e)", () => {
  it("REQ-010: GET returns null when empty", async () => {
    const app = buildApp(makeQueue());
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("REQ-011/REQ-014: PUT persists, reconciles, and round-trips through GET", async () => {
    const queue = makeQueue();
    const app = buildApp(queue);

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { topN: number; scheduleTime: string };
    expect(putBody.topN).toBe(10);
    expect(putBody.scheduleTime).toBe("09:30");

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(5);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();

    const got = await app.request("/api/settings");
    expect(got.status).toBe(200);
    const getBody = (await got.json()) as { topN: number };
    expect(getBody.topN).toBe(10);
  });

  it("REQ-021: upsert twice keeps a single row; latest wins", async () => {
    const queue = makeQueue();
    const app = buildApp(queue);

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, scheduleTime: "07:00", pipelineTime: "07:00" }),
    });

    const rows = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.singleton, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].pipelineTime).toBe("07:00");
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(10);
  });

  it("REQ-013: rejects scheduleEnabled=true with no sources", async () => {
    const app = buildApp(makeQueue());
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
});

describe("Settings ⇄ sources-rows bridge (e2e, REQ-073)", () => {
  function buildBridgeApp(queue: ReturnType<typeof makeQueue>) {
    const app = new Hono();
    const collectorHealthQueue = makeQueue();
    app.route(
      "/api/settings",
      createSettingsRouter({
        getSettingsRepo: () => createUserSettingsRepo(db, tenantCtx),
        getSourcesRepo: () => createSourcesRepo(db, tenantCtx),
        processingQueue: queue as never,
        collectorHealthQueue: collectorHealthQueue as never,
      }),
    );
    return app;
  }

  beforeEach(async () => {
    await db.delete(sources).where(eq(sources.tenantId, tenantCtx.tenantId));
  });

  afterAll(async () => {
    await db.delete(sources).where(eq(sources.tenantId, tenantCtx.tenantId));
  });

  it("GET overlays the card's collector configs from the tenant's source rows", async () => {
    const app = buildBridgeApp(makeQueue());
    // Settings row exists but its reddit JSONB is empty…
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    // …while the real collection set lives in `sources` rows (as onboarding writes).
    const repo = createSourcesRepo(db, tenantCtx);
    await repo.create({ type: "reddit", config: { kind: "reddit", subreddit: "videoproduction", sinceDays: 1 } });
    await repo.create({ type: "reddit", config: { kind: "reddit", subreddit: "streaming", sinceDays: 1 } });

    const res = await app.request("/api/settings");
    const body = (await res.json()) as { redditEnabled: boolean; redditConfig: { subreddits: string[] } | null };
    expect(body.redditEnabled).toBe(true);
    expect(body.redditConfig?.subreddits.sort()).toEqual(["streaming", "videoproduction"]);
  });

  it("PUT reconciles the sources table (replace-all) for a tenant already on rows", async () => {
    const app = buildBridgeApp(makeQueue());
    const repo = createSourcesRepo(db, tenantCtx);
    await repo.create({ type: "reddit", config: { kind: "reddit", subreddit: "old", sinceDays: 1 } });

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        scheduleEnabled: false,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: true,
        redditConfig: { subreddits: ["mlops", "LocalLLaMA"], sinceDays: 1 },
      }),
    });
    expect(res.status).toBe(200);

    const rows = await repo.list();
    const subreddits = rows
      .map((r) => (r.config.kind === "reddit" ? r.config.subreddit : null))
      .filter((s): s is string => s !== null)
      .sort();
    expect(subreddits).toEqual(["LocalLLaMA", "mlops"]);
    // The stale "old" row was replaced, not appended.
    expect(rows).toHaveLength(2);
  });
});
