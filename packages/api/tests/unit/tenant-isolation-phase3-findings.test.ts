/**
 * Regression tests for confirmed Phase 3 tenant-isolation findings.
 *
 * FINDING-1 (posthog.ts): posthog-node's `enableExceptionAutocapture`
 *   registers process-GLOBAL uncaughtException/unhandledRejection listeners,
 *   so a per-tenant client with autocapture would ship every tenant's server
 *   errors to that tenant's PostHog project. Only the operator's (tenant 0)
 *   client may autocapture.
 *
 * FINDING-2 (settings.ts route) — RESOLVED in Phase 6: schedulers are now
 *   per-tenant (keys + {tenantId} job data), so every tenant's PUT reconciles
 *   its OWN schedulers and can never rewrite/delete another tenant's entries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PostHog } from "posthog-node";
import type { UserSettings } from "@newsletter/shared";
import {
  captureAnalytics,
  configurePostHog,
  resetAnalyticsForTest,
  shutdownAnalytics,
} from "@api/lib/posthog.js";
import { createSettingsRouter } from "@api/routes/settings.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import { setTestTenant, TEST_TENANT_ID } from "../helpers/tenant.js";

const TENANT_X = "11111111-2222-3333-4444-555555555555";

afterEach(async () => {
  await shutdownAnalytics();
  resetAnalyticsForTest();
  vi.restoreAllMocks();
});

describe("FINDING-1: per-tenant PostHog clients must not autocapture process-global exceptions", () => {
  it("capturing an event for a non-tenant-0 tenant registers no process-global exception listeners", async () => {
    vi.spyOn(PostHog.prototype, "capture").mockImplementation(vi.fn() as never);
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    // Tenant X configured their own PostHog destination via /api/settings.
    configurePostHog((tenantId) =>
      Promise.resolve(
        tenantId === TENANT_X
          ? {
              posthogEnabled: true,
              posthogProjectToken: "phc_tenant_x_attacker_controlled",
              posthogHost: "https://eu.i.posthog.com",
            }
          : null,
      ),
    );

    const uncaughtBefore = process.listeners("uncaughtException").length;
    const rejectionBefore = process.listeners("unhandledRejection").length;

    await captureAnalytics({
      tenantId: TENANT_X,
      distinctId: "reader-1",
      event: "archive_viewed",
    });

    expect(process.listeners("uncaughtException")).toHaveLength(uncaughtBefore);
    expect(process.listeners("unhandledRejection")).toHaveLength(rejectionBefore);
  });
});

function makeSettingsRepo(): UserSettingsRepo {
  return {
    get: () => Promise.resolve(null),
    upsert: (input) =>
      Promise.resolve({
        ...input,
        id: "row-1",
        scheduleTime: input.pipelineTime,
        updatedAt: new Date().toISOString(),
      } as UserSettings),
  };
}

function makeSchedulerQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

function buildSettingsApp(tenantId: string) {
  const queue = makeSchedulerQueue();
  const app = new Hono();
  app.use("*", setTestTenant(tenantId));
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => makeSettingsRepo(),
      getNotificationSettingsRepo: () => ({
        get: () => Promise.resolve(null),
        update: () => Promise.resolve(),
      }),
      cipher: { encrypt: (pt: string) => ({ ct: pt, iv: "iv", tag: "tag" }) },
      getSourcesRepo: () => ({ replaceAll: () => Promise.resolve([]) }),
      processingQueue: queue as never,
      collectorHealthQueue: queue as never,
      isTenantActive: () => Promise.resolve(true),
      tenantFeatures: {
        get: () => Promise.resolve(null),
        update: () => Promise.resolve(null),
      },
      rettiwtFactory: () => ({}) as never,
    }),
  );
  return { app, queue };
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
  scheduleEnabled: false,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
  rankingPrompt: "Default ranking prompt for tests",
  shortlistPrompt: "Default shortlist prompt for tests",
  shortlistSize: 30,
};

describe("FINDING-2 (resolved by Phase 6): settings saves reconcile only the caller's own schedulers", () => {
  it("PUT /api/settings as tenant X reconciles exclusively tenant-X-keyed schedulers", async () => {
    const { app, queue } = buildSettingsApp(TENANT_X);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, scheduleEnabled: true }),
    });
    expect(res.status).toBe(200);
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
    const touchedKeys = [
      ...queue.upsertJobScheduler.mock.calls,
      ...queue.removeJobScheduler.mock.calls,
    ].map((c) => c[0] as string);
    expect(touchedKeys.length).toBeGreaterThan(0);
    for (const key of touchedKeys) {
      expect(key.endsWith(`:${TENANT_X}`)).toBe(true);
    }
  });

  it("PUT /api/settings as tenant 0 still reconciles the schedulers", async () => {
    const { app, queue } = buildSettingsApp(TEST_TENANT_ID);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, scheduleEnabled: true }),
    });
    expect(res.status).toBe(200);
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
  });
});
