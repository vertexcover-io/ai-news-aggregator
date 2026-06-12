/**
 * Adversarial Phase 11/12 review — regression tests for the two confirmed
 * material findings (both FIXED; these encode the secure behavior).
 *
 * F-AUTH-1: the impersonation cookie must be issued only AFTER the REQ-103
 *           audit row is written — an audit-store failure must not yield an
 *           unaudited privileged impersonation cookie.
 * F-SLUG-1: a tenant must not be able to claim another tenant's previous_slug
 *           (it would hijack that tenant's 301 redirect traffic — REQ-023 /
 *           EDGE-002). Repo-level coverage against the real DB lives in
 *           tests/e2e/onboarding-tenants-repo.e2e.test.ts; here we pin the
 *           route contract: slug-check surfaces the repo's verdict.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { issueSession, withImpersonation } from "@api/auth/session.js";
import {
  createOnboardingRouter,
  type OnboardingRouterDeps,
} from "@api/routes/onboarding.js";

const SECRET = "test-secret-test-secret-test-secret-xx";

function superAdminCookie(imp?: string): string {
  const token = issueSession(
    { uid: "super-1", tid: null, role: "super_admin" },
    SECRET,
  );
  if (imp === undefined) return `session=${token}`;
  const claims = {
    uid: "super-1",
    tid: null,
    role: "super_admin" as const,
    iat: Date.now(),
  };
  return `session=${withImpersonation(claims, imp, SECRET)}`;
}

function failingAuditApp(): Hono {
  const router = createSuperAdminRouter({
    sessionSecret: SECRET,
    getTenantsRepo: () => ({
      list: () => Promise.resolve([]),
      findById: () =>
        Promise.resolve({
          id: "tenant-A",
          slug: "acme",
          previousSlug: null,
          name: "Acme",
          status: "active" as const,
          createdAt: new Date(),
        }),
    }),
    getImpersonationEventsRepo: () => ({
      record: () => Promise.reject(new Error("audit store down")),
    }),
  });
  const app = new Hono();
  app.route("/api/super-admin", router);
  app.onError((_e, c) => c.json({ error: "Internal Server Error" }, 500));
  return app;
}

describe("F-AUTH-1: impersonation must not issue a cookie when the audit write fails", () => {
  it("does not set an impersonation cookie if the start audit row cannot be recorded", async () => {
    const res = await failingAuditApp().request(
      "/api/super-admin/impersonate/tenant-A",
      { method: "POST", headers: { cookie: superAdminCookie() } },
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not strip the imp claim if the stop audit row cannot be recorded", async () => {
    const res = await failingAuditApp().request(
      "/api/super-admin/exit-impersonation",
      { method: "POST", headers: { cookie: superAdminCookie("tenant-A") } },
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("F-SLUG-1: claiming another tenant's previous_slug must be rejected", () => {
  it("slug-check reports a slug the repo holds (incl. as previous_slug) as taken", async () => {
    const deps = {
      tenantsRepo: {
        getOnboardingState: () =>
          Promise.resolve({
            id: "tenant-B",
            slug: "pending-deadbeef",
            name: "B",
            status: "pending_setup" as const,
            headline: null,
            topicStrip: null,
            subtagline: null,
            logoVersion: 0,
            onboarding: null,
          }),
        updateOnboarding: () => Promise.resolve(),
        updateBranding: () => Promise.resolve(null),
        updateStatus: () => Promise.resolve(null),
        setSlug: () =>
          Promise.resolve({ ok: false as const, reason: "taken" as const }),
        // Fixed repo contract: previous_slug held by another tenant ⇒ taken.
        isSlugTaken: () => Promise.resolve(true),
      },
      getSettingsRepo: () => ({}) as never,
      getSourcesRepo: () => ({ listEnabled: () => Promise.resolve([]) }),
      promptGeneration: null,
      processingQueue: {} as never,
      collectorHealthQueue: {} as never,
    } satisfies OnboardingRouterDeps;

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth", {
        userId: "u",
        role: "tenant_admin",
        tenantId: "tenant-B",
        realTenantId: "tenant-B",
        impersonating: false,
      });
      await next();
    });
    app.route("/", createOnboardingRouter(deps));

    const check = await app.request("/slug-check?slug=foo");
    expect(((await check.json()) as { status: string }).status).toBe("taken");

    const patch = await app.request("/state", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step: "slug", data: { slug: "foo" } }),
    });
    expect(patch.status).toBe(409);
  });
});
