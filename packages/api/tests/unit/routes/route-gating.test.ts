import { describe, it, expect, vi } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import { buildApp } from "@api/app.js";
import {
  createPublicArchivesRouter,
  createAdminArchivesRouter,
  type ArchivesRouterDeps,
} from "@api/routes/archives.js";
import { createAuthRouter } from "@api/routes/auth.js";
import { requireUser } from "@api/auth/middleware.js";
import { makeSessionCookie } from "@api-tests/helpers/auth.js";
import type {
  ArchiveListItem,
  RankedItemRef,
} from "@newsletter/shared";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { PasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";

const SESSION_SECRET = "test-session-secret";

function makeRawItemsRepo(): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve([])),
  };
}

function makeArchiveRepo(options?: {
  list?: ArchiveListItem[];
  row?: RunArchiveRow | null;
}): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(options?.row ?? null)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve(options?.list ?? [])),
    updateRankedItems: vi.fn(() =>
      Promise.reject(new Error("not used")),
    ),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  };
}

function makeArchivesDeps(
  archiveRepo: RunArchivesRepo,
): ArchivesRouterDeps {
  return {
    getRawItemsRepo: () => makeRawItemsRepo(),
    getArchiveRepo: () => archiveRepo,
  };
}

function makeStubUsersRepo(): UsersRepo {
  return {
    findByEmail: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(() => Promise.resolve(null)),
    findTenantById: vi.fn(() => Promise.resolve(null)),
    createTenantAdminWithTenant: vi.fn(() =>
      Promise.reject(new Error("not used")),
    ),
    updatePassword: vi.fn(() => Promise.resolve()),
    createSuperAdmin: vi.fn(() => Promise.reject(new Error("not used"))),
  };
}

function makeStubResetRepo(): PasswordResetTokensRepo {
  return {
    create: vi.fn(() => Promise.reject(new Error("not used"))),
    findValidByHash: vi.fn(() => Promise.resolve(null)),
    consume: vi.fn(() => Promise.resolve(true)),
  };
}

function makeStubRunsRouter(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json({ runs: [] }));
  return app;
}

function makeStubSettingsRouter(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json(null));
  return app;
}

function makeStubSubscribeRouter(): Hono {
  const app = new Hono();
  app.post("/subscribe", (c) => c.json({ ok: true }));
  return app;
}

function makeStubWebhooksRouter(): Hono {
  const app = new Hono();
  app.post("/ses", (c) => c.json({ ok: true }));
  return app;
}

function makeStubAnalyticsRouter(): Hono {
  return new Hono();
}

function makeStubAnalyticsConfigRouter(): Hono {
  const app = new Hono();
  app.get("/", (c) =>
    c.json({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    }),
  );
  return app;
}

function makeApp(
  archiveRepo: RunArchivesRepo = makeArchiveRepo(),
): Hono {
  const deps = makeArchivesDeps(archiveRepo);
  return buildApp({
    publicTenantMiddleware: setTestTenant(),
    sessionSecret: SESSION_SECRET,
    publicArchivesRouter: createPublicArchivesRouter(deps),
    publicHomeRouter: new Hono(),
    publicMustReadRouter: new Hono(),
    archivesSearchRouter: new Hono(),
    publicSourcesRouter: new Hono(),
    adminArchivesRouter: createAdminArchivesRouter(deps),
    adminRunsRouter: new Hono(),
    adminEvalRouter: new Hono(),
    adminSocialCredentialsRouter: new Hono(),
    adminMustReadRouter: new Hono(),
    adminSourcesRouter: new Hono(),
    runsRouter: makeStubRunsRouter(),
    settingsRouter: makeStubSettingsRouter(),
    authRouter: createAuthRouter({
      sessionSecret: SESSION_SECRET,
      getUsersRepo: makeStubUsersRepo,
      getResetTokensRepo: makeStubResetRepo,
      emailProvider: {
        send: vi.fn(() => Promise.resolve({ messageId: "m" })),
      },
      fromEmail: "platform@example.com",
      webBaseUrl: "https://app.example.com",
    }),
    requireUserFactory: requireUser,
    subscribeRouter: makeStubSubscribeRouter(),
    webhooksRouter: makeStubWebhooksRouter(),
    analyticsRouter: makeStubAnalyticsRouter(),
    analyticsConfigRouter: makeStubAnalyticsConfigRouter(),
    linkedInOAuthRouter: new Hono(),
    linkedInOAuthCallbackRouter: new Hono(),
    collectorHealthRouter: new Hono(),
    sendingDomainRouter: new Hono(),
    twitterOAuthRouter: new Hono(),
    twitterOAuthCallbackRouter: new Hono(),
    publicTenantConfigRouter: new Hono(),
    publicTenantLogoRouter: new Hono(),
    adminBrandingRouter: new Hono(),
  });
}

const cookie = makeSessionCookie(SESSION_SECRET);

describe("route gating", () => {
  it("1. GET /api/archives is public (200 without cookie)", async () => {
    const archiveRepo = makeArchiveRepo({
      list: [{ runId: "run-1", runDate: "2026-04-15", storyCount: 3 }],
    });
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      archives: [{ runId: "run-1", runDate: "2026-04-15", storyCount: 3 }],
    });
  });

  it("2. GET /api/archives/:runId is public (200 without cookie)", async () => {
    const refs: RankedItemRef[] = [];
    const row: RunArchiveRow = {
      id: "run-2",
      status: "completed",
      rankedItems: refs,
      topN: 5,
      reviewed: true,
      sourceTypes: ["hn"],
      startedAt: new Date("2026-04-10T00:00:00Z"),
      completedAt: new Date("2026-04-10T01:00:00Z"),
      createdAt: new Date("2026-04-10T00:00:00Z"),
    };
    const archiveRepo = makeArchiveRepo({ row });
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives/run-2");
    expect(res.status).toBe(200);
  });

  it("3. GET /api/auth/me without cookie → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("4. GET /api/runs without cookie → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/runs");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("5. GET /api/runs with session cookie is not 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/runs", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("6. PATCH /api/admin/archives/:runId without cookie → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/admin/archives/run-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rankedItems: [] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("7. POST /api/admin/archives/:runId/add-post without cookie → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/admin/archives/run-1/add-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", sourceType: "hn" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("8. settings is also gated", async () => {
    const app = makeApp();
    const res = await app.request("/api/settings");
    expect(res.status).toBe(401);
    const ok = await app.request("/api/settings", { headers: { cookie } });
    expect(ok.status).toBe(200);
  });

  it("8b. GET /api/admin/sources without cookie → 401", async () => {
    const app = makeApp();
    const res = await app.request("/api/admin/sources");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("9. a legacy admin_session cookie no longer passes the gate", async () => {
    const app = makeApp();
    const res = await app.request("/api/runs", {
      headers: { cookie: `admin_session=${Date.now()}.deadbeef` },
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/login remains reachable without a cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "wrong-password" }),
    });
    // Should hit the handler (not the gate) even without a cookie.
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("POST /api/auth/logout remains reachable without a cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("REQ-052: GET /api/runs without cookie returns 401 with no cost-related strings in body", async () => {
    const app = makeApp();
    const res = await app.request("/api/runs");
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toMatch(/costBreakdown|inputTokens|outputTokens|totalCostUsd/);
  });

  it("REQ-053: GET /api/archives does not leak cost fields", async () => {
    const archiveRepo = makeArchiveRepo({
      list: [
        {
          runId: "run-cost",
          runDate: "2026-04-15",
          storyCount: 3,
          topItems: [],
          leadSummary: null,
          digestHeadline: null,
          digestSummary: null,
          isDryRun: false,
        },
      ],
    });
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/costBreakdown|inputTokens|outputTokens|totalCostUsd/);
  });

  it("REQ-053: GET /api/archives/:runId does not leak cost fields", async () => {
    const row: RunArchiveRow = {
      id: "run-2",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: true,
      sourceTypes: ["hn"],
      startedAt: new Date("2026-04-10T00:00:00Z"),
      completedAt: new Date("2026-04-10T01:00:00Z"),
      createdAt: new Date("2026-04-10T00:00:00Z"),
    } as unknown as RunArchiveRow;
    const archiveRepo = makeArchiveRepo({ row });
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives/run-2");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/costBreakdown|inputTokens|outputTokens|totalCostUsd/);
  });

  it("GET /api/public/analytics-config remains reachable without a cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/public/analytics-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    });
  });
});
