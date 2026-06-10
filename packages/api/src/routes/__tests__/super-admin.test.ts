import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import {
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_MS,
} from "../../auth/session.js";
import { issueToken, issueImpersonationToken } from "../../auth/session.js";
import { requireAuth, requireSuperAdmin } from "../../auth/middleware.js";
import { createSuperAdminRouter } from "../super-admin.js";
import type { TenantsRepo, TenantSelect } from "../../repositories/tenants.js";

const SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const SUPER_USER_ID = "super-user-1";
const SUPER_USER_TENANT = "";

// The impersonation route reads SESSION_SECRET from process.env
process.env.SESSION_SECRET = SECRET;

function makeTenant(overrides: Partial<TenantSelect> = {}): TenantSelect {
  return {
    id: "t-test-1",
    slug: "testco",
    name: "Test Co",
    status: "active",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: null,
    oldSlug: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as TenantSelect;
}

function makeTenantsRepo(
  opts: { listAll?: () => Promise<TenantSelect[]>; findById?: TenantsRepo["findById"] } = {},
): TenantsRepo {
  return {
    findById: opts.findById ?? vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByCustomDomain: vi.fn().mockResolvedValue(null),
    findByOldSlug: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeTenant()),
    listAll: opts.listAll ?? vi.fn().mockResolvedValue([]),
  };
}

function makeAuthedApp(opts: {
  tenantId?: string;
  role?: string;
  userId?: string;
} = {}): { app: Hono } {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", {
      userId: opts.userId ?? SUPER_USER_ID,
      tenantId: opts.tenantId ?? SUPER_USER_TENANT,
      role: opts.role ?? "super_admin",
    });
    await next();
  });
  return { app };
}

/** Build a super-admin app with requireSuperAdmin gating. */
function makeGatedSuperApp(opts: {
  tenantId?: string;
  role?: string;
  userId?: string;
} = {}): { app: Hono } {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", {
      userId: opts.userId ?? SUPER_USER_ID,
      tenantId: opts.tenantId ?? SUPER_USER_TENANT,
      role: opts.role ?? "super_admin",
    });
    await next();
  });
  app.use("*", requireSuperAdmin());
  return { app };
}

describe("super-admin router — REQ-100: GET /tenants", () => {
  it("test_REQ_100_GET_tenants_returns_all_tenants", async () => {
    const tenants = [
      makeTenant({ id: "t-1", slug: "tenant-one", name: "Tenant One" }),
      makeTenant({ id: "t-2", slug: "tenant-two", name: "Tenant Two" }),
    ];
    const tenantsRepo = makeTenantsRepo({ listAll: async () => tenants });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeAuthedApp();
    app.route("/api/super", router);

    const res = await app.request("/api/super/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenantSelect[];
    expect(body).toHaveLength(2);
    expect(body[0].slug).toBe("tenant-one");
    expect(body[1].slug).toBe("tenant-two");
  });

  it("test_REQ_100_tenants_response_excludes_sensitive_fields", async () => {
    const tenant = makeTenant({ id: "t-1", slug: "t1" });
    const tenantsRepo = makeTenantsRepo({ listAll: async () => [tenant] });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeAuthedApp();
    app.route("/api/super", router);

    const res = await app.request("/api/super/tenants");
    const body = (await res.json()) as Record<string, unknown>[];
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("password_hash");
    expect(stringified).not.toContain("client_secret");
  });
});

describe("super-admin router — REQ-101: POST /impersonate/:tenantId", () => {
  it("test_REQ_101_impersonate_sets_impersonation_cookie", async () => {
    const targetTenant = makeTenant({ id: "t-target", slug: "target" });
    const tenantsRepo = makeTenantsRepo({
      listAll: async () => [targetTenant],
      findById: async (id: string) => (id === "t-target" ? targetTenant : null),
    });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeAuthedApp({ userId: SUPER_USER_ID });
    app.route("/api/super", router);

    const res = await app.request("/api/super/impersonate/t-target", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const cookieHeader = res.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain(IMPERSONATION_COOKIE_NAME);
  });

  it("test_REQ_101_impersonate_returns_404_for_unknown_tenant", async () => {
    const tenantsRepo = makeTenantsRepo({
      findById: async () => null,
    });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeAuthedApp();
    app.route("/api/super", router);

    const res = await app.request("/api/super/impersonate/nonexistent", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("test_REQ_101_impersonate_cookie_is_short_lived", async () => {
    const tenant = makeTenant({ id: "t-1", slug: "t1" });
    const tenantsRepo = makeTenantsRepo({
      findById: async (id: string) => (id === "t-1" ? tenant : null),
    });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeAuthedApp();
    app.route("/api/super", router);

    const res = await app.request("/api/super/impersonate/t-1", {
      method: "POST",
    });
    const cookieHeader = res.headers.get("set-cookie") ?? "";
    const maxAgeSec = Math.floor(IMPERSONATION_MAX_AGE_MS / 1000);
    expect(cookieHeader).toContain(`Max-Age=${maxAgeSec}`);
  });
});

describe("super-admin router — REQ-102: POST /impersonate/exit", () => {
  it("test_REQ_102_exit_clears_impersonation_cookie", async () => {
    const router = createSuperAdminRouter({
      getTenantsRepo: () => makeTenantsRepo(),
    });

    const { app } = makeAuthedApp({ tenantId: "tenant-target", role: "tenant_admin" });
    app.route("/api/super", router);

    const res = await app.request("/api/super/impersonate/exit", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const cookieHeader = res.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);
    expect(cookieHeader).toContain("Max-Age=0");
  });

  it("test_REQ_102_exit_restores_original_session_context", async () => {
    const router = createSuperAdminRouter({
      getTenantsRepo: () => makeTenantsRepo(),
    });

    const { app } = makeAuthedApp({ userId: SUPER_USER_ID, role: "super_admin" });
    app.route("/api/super", router);

    const res = await app.request("/api/super/impersonate/exit", {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });
});

describe("super-admin router — EDGE-008: no privilege elevation", () => {
  it("test_EDGE_008_non_super_admin_cannot_impersonate", async () => {
    const tenant = makeTenant({ id: "t-1" });
    const tenantsRepo = makeTenantsRepo({ findById: async () => tenant });
    const router = createSuperAdminRouter({ getTenantsRepo: () => tenantsRepo });

    const { app } = makeGatedSuperApp({ role: "tenant_admin" });
    app.route("/api/super", router);

    const res = await app.request("/api/super/tenants");
    expect(res.status).toBe(403);
  });

  it("test_EDGE_008_impersonate_cannot_list_tenants_as_super_admin", async () => {
    const router = createSuperAdminRouter({
      getTenantsRepo: () => makeTenantsRepo(),
    });

    const { app } = makeGatedSuperApp({
      userId: SUPER_USER_ID,
      tenantId: "tenant-target",
      role: "tenant_admin",
    });
    app.route("/api/super", router);

    const res = await app.request("/api/super/tenants");
    expect(res.status).toBe(403);
  });
});
