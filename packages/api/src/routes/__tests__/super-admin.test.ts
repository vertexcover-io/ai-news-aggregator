import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createSuperAdminRouter } from "../super-admin.js";
import { requireUser, type AuthEnv } from "../../auth/middleware.js";
import { issueSession, verifySession, COOKIE_NAME } from "../../auth/session.js";
import { getTenantId } from "@api/middleware/tenant-host.js";
import type { TenantRecord } from "../../repositories/tenants.js";
import type {
  ImpersonationAction,
  ImpersonationEventsRepo,
} from "../../repositories/impersonation-events.js";

const SECRET = "super-admin-test-secret-32-bytes-minimum!";
// Real clock: the middleware verifies cookies against Date.now(), so test
// tokens must be freshly issued to pass the 30-day window.
const NOW = Date.now();
const SUPER_UID = "99999999-9999-4999-8999-999999999999";
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function tenantRecord(id: string, slug: string): TenantRecord {
  return {
    id,
    slug,
    previousSlug: null,
    name: `Tenant ${slug}`,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

interface AuditRow {
  superAdminUserId: string;
  tenantId: string;
  action: ImpersonationAction;
}

function makeAudit(): {
  repo: Pick<ImpersonationEventsRepo, "record">;
  rows: AuditRow[];
} {
  const rows: AuditRow[] = [];
  return {
    rows,
    repo: {
      record: vi.fn(
        (
          superAdminUserId: string,
          tenantId: string,
          action: ImpersonationAction,
        ) => {
          rows.push({ superAdminUserId, tenantId, action });
          return Promise.resolve({
            id: "evt",
            superAdminUserId,
            tenantId,
            action,
            createdAt: new Date(),
          });
        },
      ),
    },
  };
}

const TENANTS = [tenantRecord(TENANT_A, "alpha"), tenantRecord(TENANT_B, "beta")];

function buildApp(audit = makeAudit()): {
  app: Hono;
  audit: ReturnType<typeof makeAudit>;
} {
  const app = new Hono();
  app.route(
    "/api/super-admin",
    createSuperAdminRouter({
      sessionSecret: SECRET,
      getTenantsRepo: () => ({
        list: () => Promise.resolve(TENANTS),
        findById: (id) =>
          Promise.resolve(TENANTS.find((t) => t.id === id) ?? null),
      }),
      getImpersonationEventsRepo: () => audit.repo,
    }),
  );

  // EDGE-008 probe: a normal tenant route behind requireUser, returning data
  // for the EFFECTIVE tenant only.
  const tenantApp = new Hono<AuthEnv>();
  tenantApp.use("*", requireUser(SECRET));
  tenantApp.get("/data", (c) =>
    c.json({ tenantId: getTenantId(c), role: c.get("auth").role }),
  );
  app.route("/api/tenant", tenantApp);

  return { app, audit };
}

function superCookie(extra: { imp?: string } = {}): string {
  return `${COOKIE_NAME}=${issueSession(
    { uid: SUPER_UID, tid: null, role: "super_admin", ...extra },
    SECRET,
    NOW,
  )}`;
}

function tenantAdminCookie(): string {
  return `${COOKIE_NAME}=${issueSession(
    { uid: "11111111-1111-4111-8111-111111111111", tid: TENANT_A, role: "tenant_admin" },
    SECRET,
    NOW,
  )}`;
}

function sessionTokenFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /(?:^|[;,]\s*)session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`no session cookie in: ${setCookie}`);
  return match[1];
}

let ctx: ReturnType<typeof buildApp>;
beforeEach(() => {
  ctx = buildApp();
});

describe("gating", () => {
  it.each([
    { name: "GET /tenants", path: "/api/super-admin/tenants", method: "GET" },
    {
      name: "POST /impersonate",
      path: `/api/super-admin/impersonate/${TENANT_A}`,
      method: "POST",
    },
    {
      name: "POST /exit-impersonation",
      path: "/api/super-admin/exit-impersonation",
      method: "POST",
    },
  ])("$name → 401 without a cookie", async ({ path, method }) => {
    const res = await ctx.app.request(path, { method });
    expect(res.status).toBe(401);
  });

  it.each([
    { name: "GET /tenants", path: "/api/super-admin/tenants", method: "GET" },
    {
      name: "POST /impersonate",
      path: `/api/super-admin/impersonate/${TENANT_A}`,
      method: "POST",
    },
    {
      name: "POST /exit-impersonation",
      path: "/api/super-admin/exit-impersonation",
      method: "POST",
    },
  ])("$name → 403 for a tenant_admin", async ({ path, method }) => {
    const res = await ctx.app.request(path, {
      method,
      headers: { cookie: tenantAdminCookie() },
    });
    expect(res.status).toBe(403);
    expect(ctx.audit.rows).toEqual([]);
  });
});

describe("GET /tenants (REQ-100)", () => {
  it("returns id/slug/name/status/createdAt for every tenant", async () => {
    const res = await ctx.app.request("/api/super-admin/tenants", {
      headers: { cookie: superCookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenants: [
        {
          id: TENANT_A,
          slug: "alpha",
          name: "Tenant alpha",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: TENANT_B,
          slug: "beta",
          name: "Tenant beta",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("stays reachable while impersonating (role drives the gate)", async () => {
    const res = await ctx.app.request("/api/super-admin/tenants", {
      headers: { cookie: superCookie({ imp: TENANT_A }) },
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /impersonate/:tenantId (REQ-101/103)", () => {
  it("unknown tenant → 404, no cookie reissue, no audit row", async () => {
    const res = await ctx.app.request(
      "/api/super-admin/impersonate/00000000-0000-4000-8000-000000000000",
      { method: "POST", headers: { cookie: superCookie() } },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(ctx.audit.rows).toEqual([]);
  });

  it("reissues the cookie with imp set, preserving uid/tid/role/iat", async () => {
    const res = await ctx.app.request(
      `/api/super-admin/impersonate/${TENANT_A}`,
      { method: "POST", headers: { cookie: superCookie() } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      impersonating: true,
      tenant: {
        id: TENANT_A,
        slug: "alpha",
        name: "Tenant alpha",
        status: "active",
      },
    });
    const claims = verifySession(sessionTokenFrom(res), SECRET, NOW);
    expect(claims).toEqual({
      uid: SUPER_UID,
      tid: null,
      role: "super_admin",
      imp: TENANT_A,
      iat: NOW,
    });
  });

  it("records a start audit row (REQ-103)", async () => {
    await ctx.app.request(`/api/super-admin/impersonate/${TENANT_A}`, {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    expect(ctx.audit.rows).toEqual([
      { superAdminUserId: SUPER_UID, tenantId: TENANT_A, action: "start" },
    ]);
  });

  it("switching tenants mid-impersonation closes the old span first", async () => {
    const res = await ctx.app.request(
      `/api/super-admin/impersonate/${TENANT_B}`,
      { method: "POST", headers: { cookie: superCookie({ imp: TENANT_A }) } },
    );
    expect(res.status).toBe(200);
    expect(verifySession(sessionTokenFrom(res), SECRET, NOW)?.imp).toBe(TENANT_B);
    expect(ctx.audit.rows).toEqual([
      { superAdminUserId: SUPER_UID, tenantId: TENANT_A, action: "stop" },
      { superAdminUserId: SUPER_UID, tenantId: TENANT_B, action: "start" },
    ]);
  });
});

describe("POST /exit-impersonation (REQ-102/103)", () => {
  it("strips imp from the cookie and records a stop audit row", async () => {
    const res = await ctx.app.request("/api/super-admin/exit-impersonation", {
      method: "POST",
      headers: { cookie: superCookie({ imp: TENANT_A }) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ impersonating: false });
    const claims = verifySession(sessionTokenFrom(res), SECRET, NOW);
    expect(claims).toEqual({
      uid: SUPER_UID,
      tid: null,
      role: "super_admin",
      iat: NOW,
    });
    expect(ctx.audit.rows).toEqual([
      { superAdminUserId: SUPER_UID, tenantId: TENANT_A, action: "stop" },
    ]);
  });

  it("is a no-op when not impersonating (no audit row, no reissue)", async () => {
    const res = await ctx.app.request("/api/super-admin/exit-impersonation", {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ impersonating: false });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(ctx.audit.rows).toEqual([]);
  });
});

describe("EDGE-008: impersonation grants tenant scope, nothing more", () => {
  it("the impersonated cookie sees the TARGET tenant's data on normal tenant routes", async () => {
    const start = await ctx.app.request(
      `/api/super-admin/impersonate/${TENANT_B}`,
      { method: "POST", headers: { cookie: superCookie() } },
    );
    const impersonatedCookie = `${COOKIE_NAME}=${sessionTokenFrom(start)}`;

    const res = await ctx.app.request("/api/tenant/data", {
      headers: { cookie: impersonatedCookie },
    });
    expect(res.status).toBe(200);
    // Effective tenant is the impersonated one; the role claim is unchanged —
    // tenant routes resolve scope ONLY through tenantId, so there is no
    // super-admin-specific behavior to leak.
    expect(await res.json()).toEqual({
      tenantId: TENANT_B,
      role: "super_admin",
    });
  });

  it("after exit, the cookie has no tenant scope on tenant routes", async () => {
    const exit = await ctx.app.request("/api/super-admin/exit-impersonation", {
      method: "POST",
      headers: { cookie: superCookie({ imp: TENANT_B }) },
    });
    const bareCookie = `${COOKIE_NAME}=${sessionTokenFrom(exit)}`;

    // getTenantId throws for a bare super admin (no tenant context) — the
    // route 500s instead of silently reading any tenant's data.
    const res = await ctx.app.request("/api/tenant/data", {
      headers: { cookie: bareCookie },
    });
    expect(res.status).toBe(500);
  });
});
