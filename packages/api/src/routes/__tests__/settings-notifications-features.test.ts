import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ScopedTenantContext, CredentialCipher } from "@newsletter/shared/services";
import { createNotificationsRouter } from "../notifications.js";
import { createFeaturesRouter } from "../features.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";

// In-memory fake cipher for tests (no env needed)
function fakeCipher(): CredentialCipher {
  return {
    encrypt(p: string) {
      return { ct: "fake-" + p, iv: "fake-iv", tag: "fake-tag" };
    },
    decrypt(b) {
      return b.ct.replace("fake-", "");
    },
  };
}

const SESSION_SECRET = "test-session-secret-32-chars-1234";

function authedHeaders(): Record<string, string> {
  const token = issueToken(SESSION_SECRET);
  return { cookie: `${COOKIE_NAME}=${token}` };
}

// Fake tenant repo
function makeTenantRepo() {
  const tenant = {
    id: "t1",
    slug: "test",
    name: "Test",
    status: "active" as const,
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    notifyEmail: null,
    slackWebhook: null,
    domainId: null,
    domainName: null,
    domainStatus: null as "none" | "pending" | "verified" | "failed" | null,
    domainRecords: null,
    onboardingState: null,
    oldSlug: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    tenant,
    findById: vi.fn((_id: string) => Promise.resolve(tenant)),
    updateNotifications: vi.fn((_id: string, data: { notifyEmail: string | null; slackWebhook: unknown }) =>
      Promise.resolve({ ...tenant, ...data }),
    ),
    updateFeatures: vi.fn((_id: string, flags: { featureCanon: boolean; featureDeliverability: boolean; featureEval: boolean }) =>
      Promise.resolve({ ...tenant, ...flags }),
    ),
  };
}

function makeScopedCtx(): ScopedTenantContext {
  return { tenantId: "t1", slug: "test", mode: "slug" };
}

function makeNotificationsRouter(repo = makeTenantRepo()) {
  const app = new Hono();
  const tenantApp = new Hono();
  const notifRouter = createNotificationsRouter({
    getTenantsRepo: () => repo,
    getCipher: () => fakeCipher(),
  });
  tenantApp.route("/", notifRouter);

  // Apply admin auth gate
  const gate = requireAdmin(SESSION_SECRET);
  app.use("*", gate);
  // Inject scoped tenant context
  app.use("*", async (c, next) => {
    c.set("tenantCtx", makeScopedCtx());
    await next();
  });
  app.route("/api/settings/notifications", tenantApp);
  return app;
}

function makeFeaturesRouter(repo = makeTenantRepo()) {
  const app = new Hono();
  const tenantApp = new Hono();
  const featuresRouter = createFeaturesRouter({
    getTenantsRepo: () => repo,
  });
  tenantApp.route("/", featuresRouter);

  const gate = requireAdmin(SESSION_SECRET);
  app.use("*", gate);
  app.use("*", async (c, next) => {
    c.set("tenantCtx", makeScopedCtx());
    await next();
  });
  app.route("/api/settings/features", tenantApp);
  return app;
}

// ── REQ-092: GET/PUT /api/settings/notifications ────────────────────────

describe("GET /api/settings/notifications", () => {
  it("returns email and webhook from tenant config", async () => {
    const repo = makeTenantRepo();
    const app = makeNotificationsRouter(repo);

    const res = await app.request("/api/settings/notifications", {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifyEmail: string | null; slackWebhook: unknown };
    expect(body).toEqual({
      notifyEmail: null,
      slackWebhook: null,
    });
  });

  it("rejects unauthenticated requests", async () => {
    const app = makeNotificationsRouter();
    const res = await app.request("/api/settings/notifications");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/settings/notifications", () => {
  it("persists email and encrypted webhook", async () => {
    const repo = makeTenantRepo();
    const app = makeNotificationsRouter(repo);

    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: "ops@example.com",
        slackWebhook: "https://hooks.slack.com/services/TEST/BOT/TOKEN",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifyEmail: string | null; slackWebhook: unknown };
    expect(body.notifyEmail).toBe("ops@example.com");

    // The webhook should be stored encrypted
    expect(repo.updateNotifications).toHaveBeenCalledTimes(1);
    const callInput = repo.updateNotifications.mock.calls[0][1];
    expect(callInput.notifyEmail).toBe("ops@example.com");
    expect(callInput.slackWebhook).toBeDefined();
    // Verify encryption format: { ct, iv, tag }
    const webhook = callInput.slackWebhook as Record<string, string>;
    expect(webhook.ct).toBeDefined();
    expect(webhook.iv).toBeDefined();
    expect(webhook.tag).toBeDefined();
  });

  it("allows clearing email", async () => {
    const repo = makeTenantRepo();
    const app = makeNotificationsRouter(repo);

    // First set
    await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: "ops@example.com",
        slackWebhook: null,
      }),
    });

    // Then clear
    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: null,
        slackWebhook: null,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifyEmail: string | null; slackWebhook: unknown };
    expect(body.notifyEmail).toBeNull();
    expect(body.slackWebhook).toBeNull();
  });

  it("rejects invalid email", async () => {
    const app = makeNotificationsRouter();

    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: "not-an-email",
        slackWebhook: null,
      }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects non-Slack webhook URL", async () => {
    const app = makeNotificationsRouter();

    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: null,
        slackWebhook: "https://evil.com/hook",
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ── REQ-093: PUT /api/settings/features ─────────────────────────────────

describe("GET /api/settings/features", () => {
  it("returns feature flags from tenant config", async () => {
    const repo = makeTenantRepo();
    const app = makeFeaturesRouter(repo);

    const res = await app.request("/api/settings/features", {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { featureCanon: boolean; featureDeliverability: boolean; featureEval: boolean };
    expect(body).toEqual({
      featureCanon: false,
      featureDeliverability: false,
      featureEval: false,
    });
  });
});

describe("PUT /api/settings/features", () => {
  it("updates feature flags independently", async () => {
    const repo = makeTenantRepo();
    const app = makeFeaturesRouter(repo);

    const res = await app.request("/api/settings/features", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        featureCanon: true,
        featureDeliverability: false,
        featureEval: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { featureCanon: boolean; featureDeliverability: boolean; featureEval: boolean };
    expect(body.featureCanon).toBe(true);
    expect(body.featureDeliverability).toBe(false);
    expect(body.featureEval).toBe(false);

    expect(repo.updateFeatures).toHaveBeenCalledWith("t1", {
      featureCanon: true,
      featureDeliverability: false,
      featureEval: false,
    });
  });

  it("rejects missing fields", async () => {
    const app = makeFeaturesRouter();

    const res = await app.request("/api/settings/features", {
      method: "PUT",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        featureCanon: true,
        // missing featureDeliverability and featureEval
      }),
    });

    expect(res.status).toBe(400);
  });
});
