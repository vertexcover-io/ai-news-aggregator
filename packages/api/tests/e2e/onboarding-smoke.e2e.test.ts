/**
 * Cross-feature smoke (Phase 11 integration): the signup → onboarding journey
 * through the REAL buildApp composition — the same mount points index.ts uses.
 *
 *   POST /api/auth/signup            → user + pending_setup tenant (Phase 2)
 *   GET  /api/admin/onboarding/state → wizard resume payload (REQ-030)
 *   PATCH name / slug                → branding + real slug claim (REQ-032/033)
 *   POST /activate                   → 422 {missing} while incomplete (REQ-038)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { getDb } from "@newsletter/shared/db";
import { buildApp } from "@api/app.js";
import { requireUser } from "@api/auth/middleware.js";
import { setTestTenant } from "../helpers/tenant.js";
import { createAuthRouter } from "@api/routes/auth.js";
import { createOnboardingRouter } from "@api/routes/onboarding.js";
import { createUsersRepo } from "@api/repositories/users.js";
import { createPasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createSourcesRepo } from "@api/repositories/sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const SESSION_SECRET = "onboarding-smoke-e2e-secret-at-least-32-bytes";
const EMAIL = "onboarding-smoke@onboarding-smoke.example.com";
const SLUG = "onboarding-smoke-e2e";

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

async function cleanup(): Promise<void> {
  const rows = await db.execute<{ tenant_id: string }>(
    sql`SELECT tenant_id FROM users WHERE email = ${EMAIL}`,
  );
  for (const row of rows) {
    await db.execute(
      sql`DELETE FROM user_settings WHERE tenant_id = ${row.tenant_id}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM users WHERE tenant_id = ${row.tenant_id}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM tenants WHERE id = ${row.tenant_id}::uuid`,
    );
  }
  await db.execute(sql`DELETE FROM tenants WHERE slug = ${SLUG}`);
}

function buildSmokeApp(): Hono {
  return buildApp({
    sessionSecret: SESSION_SECRET,
    publicTenantMiddleware: setTestTenant(),
    publicArchivesRouter: new Hono(),
    publicHomeRouter: new Hono(),
    publicMustReadRouter: new Hono(),
    archivesSearchRouter: new Hono(),
    publicSourcesRouter: new Hono(),
    adminArchivesRouter: new Hono(),
    adminRunsRouter: new Hono(),
    adminEvalRouter: new Hono(),
    adminSocialCredentialsRouter: new Hono(),
    adminMustReadRouter: new Hono(),
    adminSourcesRouter: new Hono(),
    runsRouter: new Hono(),
    settingsRouter: new Hono(),
    authRouter: createAuthRouter({
      sessionSecret: SESSION_SECRET,
      getUsersRepo: () => createUsersRepo(db),
      getResetTokensRepo: () => createPasswordResetTokensRepo(db),
      emailProvider: { send: vi.fn(() => Promise.resolve({ messageId: "m" })) },
      fromEmail: "platform@example.com",
      webBaseUrl: "https://app.example.com",
    }),
    requireUserFactory: requireUser,
    subscribeRouter: new Hono(),
    webhooksRouter: new Hono(),
    analyticsRouter: new Hono(),
    analyticsConfigRouter: new Hono(),
    linkedInOAuthRouter: new Hono(),
    linkedInOAuthCallbackRouter: new Hono(),
    collectorHealthRouter: new Hono(),
    sendingDomainRouter: new Hono(),
    twitterOAuthRouter: new Hono(),
    twitterOAuthCallbackRouter: new Hono(),
    publicTenantConfigRouter: new Hono(),
    publicTenantLogoRouter: new Hono(),
    adminBrandingRouter: new Hono(),
    onboardingRouter: createOnboardingRouter({
      tenantsRepo: createTenantsRepo(db),
      getSettingsRepo: (tenantId) => createUserSettingsRepo(db, tenantId),
      getSourcesRepo: (tenantId) => createSourcesRepo(db, tenantId),
      promptGeneration: null,
      processingQueue: makeQueue() as never,
      collectorHealthQueue: makeQueue() as never,
    }),
  });
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("signup → onboarding → activate smoke (real buildApp wiring)", () => {
  const app = buildSmokeApp();
  let cookie = "";

  it("signup creates a pending_setup tenant and sets a session cookie", async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Tester",
        email: EMAIL,
        password: "smoke-password-1",
        confirmPassword: "smoke-password-1",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tenant: { status: string } };
    expect(body.tenant.status).toBe("pending_setup");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    cookie = (setCookie ?? "").split(";")[0];
  });

  it("the onboarding gate rejects unauthenticated state reads", async () => {
    const res = await app.request("/api/admin/onboarding/state");
    expect(res.status).toBe(401);
  });

  it("GET state shows the placeholder slug and zero progress", async () => {
    const res = await app.request("/api/admin/onboarding/state", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenant: { slug: string; status: string };
      onboarding: { furthestStep: number; completed: string[] };
    };
    expect(body.tenant.status).toBe("pending_setup");
    expect(body.tenant.slug).toMatch(/^pending-/);
    expect(body.onboarding.completed).toEqual([]);
  });

  it("PATCH name persists and advances progress", async () => {
    const res = await app.request("/api/admin/onboarding/state", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ step: "name", data: { name: "Smoke Daily" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenant: { name: string };
      onboarding: { completed: string[] };
    };
    expect(body.tenant.name).toBe("Smoke Daily");
    expect(body.onboarding.completed).toContain("name");
  });

  it("slug-check reports the new slug available, then PATCH slug claims it", async () => {
    const check = await app.request(
      `/api/admin/onboarding/slug-check?slug=${SLUG}`,
      { headers: { cookie } },
    );
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ status: "available" });

    const res = await app.request("/api/admin/onboarding/state", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ step: "slug", data: { slug: SLUG } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { slug: string } };
    expect(body.tenant.slug).toBe(SLUG);
  });

  it("activate while incomplete is 422 with the remaining steps", async () => {
    const res = await app.request("/api/admin/onboarding/activate", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe("onboarding_incomplete");
    expect(body.missing).toEqual(
      expect.arrayContaining(["homepage", "prompts", "sources", "schedule"]),
    );
    expect(body.missing).not.toContain("name");
    expect(body.missing).not.toContain("slug");

    const status = await db.execute<{ status: string }>(
      sql`SELECT status FROM tenants WHERE slug = ${SLUG}`,
    );
    expect(status[0]?.status).toBe("pending_setup");
  });
});
