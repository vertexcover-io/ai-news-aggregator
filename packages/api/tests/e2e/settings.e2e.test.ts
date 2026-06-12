/**
 * Phase 3 e2e: real Redis, real DB for user_settings.
 * Verifies PUT -> GET round-trip and scheduler reconciliation using a mocked queue.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setTestTenant } from "../helpers/tenant.js";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, userSettings } from "@newsletter/shared/db";
import { createSettingsRouter } from "@api/routes/settings.js";
import { createTenantFeaturesRepo } from "@api/repositories/tenant-features.js";
import {
  createNotificationSettingsRepo,
  createUserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  createSourcesRepo,
  type SourceCreateInput,
  type SourceRecord,
} from "@api/repositories/sources.js";

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

const db = getDb();
const sourcesRepo = createSourcesRepo(db, TENANT_ZERO_ID);

// PUT /api/settings write-through-syncs the tenant's sources rows — snapshot
// and restore tenant 0's rows so the suite leaves the dev DB untouched.
let savedSourceRows: SourceRecord[] = [];
const toCreateInput = (r: SourceRecord): SourceCreateInput =>
  ({ type: r.type, config: r.config, enabled: r.enabled }) as SourceCreateInput;

beforeAll(async () => {
  savedSourceRows = await sourcesRepo.list();
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
});

afterAll(async () => {
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
  await sourcesRepo.replaceAll(savedSourceRows.map(toCreateInput));
});

beforeEach(async () => {
  await db.delete(userSettings).where(eq(userSettings.singleton, true));
});

function buildApp(queue: ReturnType<typeof makeQueue>) {
  const app = new Hono();
  app.use("*", setTestTenant());
  // Separate mock for the dedicated collector-health queue (D-110) so the
  // processing-queue scheduler-call assertions below are not affected by the
  // collector-health reconcile.
  const collectorHealthQueue = makeQueue();
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => createUserSettingsRepo(db, TENANT_ZERO_ID),
      getNotificationSettingsRepo: () =>
        createNotificationSettingsRepo(db, TENANT_ZERO_ID),
      cipher: getCredentialCipher(),
      getSourcesRepo: () => createSourcesRepo(db, TENANT_ZERO_ID),
      processingQueue: queue as never,
      collectorHealthQueue: collectorHealthQueue as never,
      isTenantActive: () => Promise.resolve(true),
      tenantFeatures: createTenantFeaturesRepo(db),
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

  it("write-through sync: PUT replaces the tenant's sources rows with the exploded configs", async () => {
    const app = buildApp(makeQueue());
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(put.status).toBe(200);

    const rows = await sourcesRepo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "hn",
      config: { sinceDays: 1 },
      enabled: true,
    });
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

  it("REQ-092: notification email + slack webhook persist; webhook stored encrypted and never echoed", async () => {
    const app = buildApp(makeQueue());
    const webhook = "https://hooks.slack.com/services/T/B/e2e-secret";

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        notificationEmail: "ops@e2e.example.com",
        slackWebhookUrl: webhook,
      }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as Record<string, unknown>;
    expect(putBody.notificationEmail).toBe("ops@e2e.example.com");
    expect(putBody.hasSlackWebhook).toBe(true);
    expect(JSON.stringify(putBody)).not.toContain(webhook);

    const rows = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.singleton, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].notificationEmail).toBe("ops@e2e.example.com");
    const blob = rows[0].slackWebhookEncrypted;
    if (blob === null || blob === undefined) {
      throw new Error("expected slack_webhook_encrypted to be stored");
    }
    expect(JSON.stringify(blob)).not.toContain(webhook);
    expect(getCredentialCipher().decrypt(blob)).toBe(webhook);

    const got = await app.request("/api/settings");
    const getBody = (await got.json()) as Record<string, unknown>;
    expect(getBody.notificationEmail).toBe("ops@e2e.example.com");
    expect(getBody.hasSlackWebhook).toBe(true);
    expect(JSON.stringify(getBody)).not.toContain(webhook);
  });
});
