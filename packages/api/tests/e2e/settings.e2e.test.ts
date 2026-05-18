/**
 * Phase 3 e2e: real Redis, real DB for user_settings.
 * Verifies PUT -> GET round-trip and scheduler reconciliation using a mocked queue.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, userSettings } from "@newsletter/shared/db";
import { createSettingsRouter } from "@api/routes/settings.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

const db = getDb();

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
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => createUserSettingsRepo(db),
      processingQueue: queue as never,
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
    expect(rows[0].scheduleTime).toBe("07:00");
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
