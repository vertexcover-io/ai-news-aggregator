/**
 * P6 integration: super-admin console backend + audited impersonation against
 * the real DB (routes/super-admin.ts, repositories/audit-log.ts,
 * repositories/tenants.ts listAll, auth/session.ts impersonation token,
 * auth/middleware.ts requireAuth swap, routes/auth.ts /me impersonation).
 *
 * REQ-100: GET /api/super/tenants lists tenants — super_admin only.
 * REQ-101: POST /api/super/impersonate/:tenantId issues the impersonation
 *          cookie; requireAuth then scopes tenantCtx to the acting tenant.
 * REQ-102: GET /api/auth/me surfaces the impersonation (banner data);
 *          POST /api/super/impersonate/exit clears it.
 * REQ-103: audit_log rows on impersonation start AND stop.
 * REQ-082/NF6: app-level secrets never appear in tenant-facing responses.
 * EDGE-008: impersonation grants no privilege beyond a tenant admin.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { getDb, users, tenants, auditLog } from "@newsletter/shared/db";
import type { AuditLogRow } from "@newsletter/shared/db";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { createAuthRouter } from "@api/routes/auth.js";
import { createAdminSocialCredentialsRouter } from "@api/routes/admin-social-credentials.js";
import { createAuditLogRepo } from "@api/repositories/audit-log.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createUsersRepo } from "@api/repositories/users.js";
import { createSocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import { requireAuth } from "@api/auth/middleware.js";
import { createRateLimiter } from "@api/auth/rate-limit.js";
import {
  issueToken,
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
} from "@api/auth/session.js";

const SESSION_SECRET = "p6-super-admin-test-secret-32-bytes!!";
const STAMP = `p6sa${Date.now().toString(36)}`;
const SECRET_SENTINEL = `p6-app-secret-${STAMP}-never-serialized`;

const db = getDb();
const cipher = getCredentialCipher({ SESSION_SECRET } as NodeJS.ProcessEnv);

let superId: string;
let tenantAdminId: string;
let tenantAId: string;
let tenantBId: string;

function buildTestApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/super",
    createSuperAdminRouter({
      sessionSecret: SESSION_SECRET,
      getTenantsRepo: () => createTenantsRepo(db),
      getAuditLogRepo: () => createAuditLogRepo(db),
    }),
  );
  app.route(
    "/api/auth",
    createAuthRouter({
      sessionSecret: SESSION_SECRET,
      getUsersRepo: () => createUsersRepo(db),
      getTenantsRepo: () => createTenantsRepo(db),
      resetTokenStore: {
        save: () => Promise.resolve(),
        consume: () => Promise.resolve(null),
      },
      sendResetEmail: () => Promise.resolve(),
      webBaseUrl: "http://web.test",
      logger: { info: vi.fn(), warn: vi.fn() },
      rateLimiter: createRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
    }),
  );
  // Tenant-facing credentials status route (REQ-082 serializer check).
  const credsApp = new Hono();
  credsApp.use("*", requireAuth(SESSION_SECRET));
  credsApp.route(
    "/",
    createAdminSocialCredentialsRouter({
      getRepo: () =>
        createSocialCredentialsRepo(db, cipher, {
          tenantId: tenantBId,
          role: "tenant_admin",
        }),
    }),
  );
  app.route("/api/admin/social-credentials", credsApp);
  // Probe for the requireAuth tenant swap (REQ-101).
  app.get("/api/admin/probe", requireAuth(SESSION_SECRET), (c) =>
    c.json({ tenantCtx: c.get("tenantCtx") }),
  );
  return app;
}

function superCookie(): string {
  return `${COOKIE_NAME}=${issueToken({ userId: superId, tenantId: null, role: "super_admin" }, SESSION_SECRET)}`;
}

function tenantAdminCookie(): string {
  return `${COOKIE_NAME}=${issueToken({ userId: tenantAdminId, tenantId: tenantBId, role: "tenant_admin" }, SESSION_SECRET)}`;
}

function impersonationCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${IMPERSONATION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (!m) throw new Error(`no ${IMPERSONATION_COOKIE_NAME} in: ${setCookie}`);
  return `${IMPERSONATION_COOKIE_NAME}=${m[1]}`;
}

async function auditRows(): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.tenantId, [tenantAId, tenantBId]));
}

beforeAll(async () => {
  const [tA] = await db
    .insert(tenants)
    .values({ slug: `${STAMP}-a`, name: `P6 Tenant A ${STAMP}`, status: "active" })
    .returning();
  const [tB] = await db
    .insert(tenants)
    .values({ slug: `${STAMP}-b`, name: `P6 Tenant B ${STAMP}`, status: "active" })
    .returning();
  tenantAId = tA.id;
  tenantBId = tB.id;
  const [superRow] = await db
    .insert(users)
    .values({
      tenantId: null,
      email: `${STAMP}-super@example.com`,
      name: "P6 Super",
      passwordHash: "scrypt$N=16384,r=8,p=1$AAAA$AAAA",
      role: "super_admin",
    })
    .returning();
  superId = superRow.id;
  const [adminRow] = await db
    .insert(users)
    .values({
      tenantId: tenantBId,
      email: `${STAMP}-admin@example.com`,
      name: "P6 Tenant Admin",
      passwordHash: "scrypt$N=16384,r=8,p=1$AAAA$AAAA",
      role: "tenant_admin",
    })
    .returning();
  tenantAdminId = adminRow.id;
});

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantAId, tenantBId]));
  await db.delete(users).where(inArray(users.id, [superId, tenantAdminId]));
  await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
});

describe("super-admin console backend (P6)", () => {
  it("test_REQ_100_super_tenant_list", async () => {
    const app = buildTestApp();

    // Gate: unauthenticated → 401; tenant_admin → 403 (requireSuperAdmin).
    expect((await app.request("/api/super/tenants")).status).toBe(401);
    expect(
      (
        await app.request("/api/super/tenants", {
          headers: { cookie: tenantAdminCookie() },
        })
      ).status,
    ).toBe(403);

    const res = await app.request("/api/super/tenants", {
      headers: { cookie: superCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: { id: string; slug: string; name: string; status: string }[];
    };
    const ids = body.tenants.map((t) => t.id);
    expect(ids).toContain(tenantAId);
    expect(ids).toContain(tenantBId);
    // Serializer exposes only the summary fields — never logo bytes or any
    // raw row spill (REQ-082/NF6 discipline for super responses too).
    const entry = body.tenants.find((t) => t.id === tenantAId);
    expect(entry).toEqual({
      id: tenantAId,
      slug: `${STAMP}-a`,
      name: `P6 Tenant A ${STAMP}`,
      status: "active",
      createdAt: expect.any(String) as unknown as string,
    });
  });

  it("test_REQ_101_impersonation_sets_acting_tenant", async () => {
    const app = buildTestApp();

    // Unknown tenant → 404, no cookie issued.
    const missing = await app.request(
      "/api/super/impersonate/00000000-0000-4000-8000-000000000000",
      { method: "POST", headers: { cookie: superCookie() } },
    );
    expect(missing.status).toBe(404);

    const start = await app.request(`/api/super/impersonate/${tenantAId}`, {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    expect(start.status).toBe(200);
    const impCookie = impersonationCookieFrom(start);

    // requireAuth now scopes the request to the ACTING tenant (REQ-101) while
    // keeping the super admin's identity (audit, REQ-103).
    const probe = await app.request("/api/admin/probe", {
      headers: { cookie: `${superCookie()}; ${impCookie}` },
    });
    expect(probe.status).toBe(200);
    const { tenantCtx } = (await probe.json()) as {
      tenantCtx: { userId: string; tenantId: string; role: string; impersonating?: boolean };
    };
    expect(tenantCtx).toEqual({
      userId: superId,
      tenantId: tenantAId,
      role: "super_admin",
      impersonating: true,
    });
  });

  it("test_REQ_102_me_surfaces_impersonation_and_exit_clears_it", async () => {
    const app = buildTestApp();
    const start = await app.request(`/api/super/impersonate/${tenantAId}`, {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    const impCookie = impersonationCookieFrom(start);

    // /me carries the acting tenant — the web banner's data source (REQ-102).
    const me = await app.request("/api/auth/me", {
      headers: { cookie: `${superCookie()}; ${impCookie}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      impersonation?: { tenant: { id: string; name: string } } | null;
    };
    expect(meBody.impersonation?.tenant.id).toBe(tenantAId);
    expect(meBody.impersonation?.tenant.name).toBe(`P6 Tenant A ${STAMP}`);

    // Exit deletes the cookie (Max-Age=0) — banner data gone afterwards.
    const exit = await app.request("/api/super/impersonate/exit", {
      method: "POST",
      headers: { cookie: `${superCookie()}; ${impCookie}` },
    });
    expect(exit.status).toBe(200);
    const cleared = exit.headers.get("set-cookie") ?? "";
    expect(cleared).toContain(`${IMPERSONATION_COOKIE_NAME}=`);
    expect(/max-age=0/i.test(cleared)).toBe(true);

    // Without the impersonation cookie /me reports no impersonation.
    const meAfter = await app.request("/api/auth/me", {
      headers: { cookie: superCookie() },
    });
    const meAfterBody = (await meAfter.json()) as {
      impersonation?: { tenant: { id: string } } | null;
    };
    expect(meAfterBody.impersonation ?? null).toBeNull();
  });

  it("test_REQ_103_audit_rows_on_start_and_stop", async () => {
    const app = buildTestApp();
    const before = (await auditRows()).length;

    const start = await app.request(`/api/super/impersonate/${tenantBId}`, {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    expect(start.status).toBe(200);
    const impCookie = impersonationCookieFrom(start);

    const afterStart = await auditRows();
    const startRows = afterStart.filter(
      (r) => r.action === "impersonation_start" && r.tenantId === tenantBId,
    );
    expect(startRows.length).toBeGreaterThanOrEqual(1);
    expect(startRows.at(-1)?.actorUserId).toBe(superId);

    const exit = await app.request("/api/super/impersonate/exit", {
      method: "POST",
      headers: { cookie: `${superCookie()}; ${impCookie}` },
    });
    expect(exit.status).toBe(200);

    const afterStop = await auditRows();
    const stopRows = afterStop.filter(
      (r) => r.action === "impersonation_stop" && r.tenantId === tenantBId,
    );
    expect(stopRows.length).toBeGreaterThanOrEqual(1);
    expect(stopRows.at(-1)?.actorUserId).toBe(superId);
    expect(afterStop.length).toBe(before + 2);
  });

  it("test_EDGE_008_impersonation_grants_no_privilege_elevation", async () => {
    const app = buildTestApp();
    const start = await app.request(`/api/super/impersonate/${tenantAId}`, {
      method: "POST",
      headers: { cookie: superCookie() },
    });
    const impCookie = impersonationCookieFrom(start);

    // A tenant_admin session carrying a stolen impersonation cookie gains
    // nothing: super routes still 403, and the cookie is ignored on probe.
    const superList = await app.request("/api/super/tenants", {
      headers: { cookie: `${tenantAdminCookie()}; ${impCookie}` },
    });
    expect(superList.status).toBe(403);
    const probe = await app.request("/api/admin/probe", {
      headers: { cookie: `${tenantAdminCookie()}; ${impCookie}` },
    });
    const { tenantCtx } = (await probe.json()) as {
      tenantCtx: { tenantId: string; impersonating?: boolean };
    };
    expect(tenantCtx.tenantId).toBe(tenantBId); // own tenant, not the acting one
    expect(tenantCtx.impersonating).toBeUndefined();

    // The impersonation cookie alone never authenticates (separate token).
    expect(
      (await app.request("/api/admin/probe", { headers: { cookie: impCookie } }))
        .status,
    ).toBe(401);
  });

  it("test_REQ_082_app_secrets_absent_from_tenant_responses", async () => {
    const app = buildTestApp();
    // Store app-level LinkedIn credentials (client secret = sentinel).
    const credsRepo = createSocialCredentialsRepo(db, cipher, {
      tenantId: tenantBId,
      role: "tenant_admin",
    });
    await credsRepo.upsertLinkedIn({
      clientId: `client-${STAMP}`,
      clientSecret: SECRET_SENTINEL,
    });
    try {
      // Tenant-facing status route must never serialize the secret (NF6).
      const status = await app.request("/api/admin/social-credentials", {
        headers: { cookie: tenantAdminCookie() },
      });
      expect(status.status).toBe(200);
      expect(await status.text()).not.toContain(SECRET_SENTINEL);

      // Super-admin tenant list never carries credential material either.
      const list = await app.request("/api/super/tenants", {
        headers: { cookie: superCookie() },
      });
      expect(await list.text()).not.toContain(SECRET_SENTINEL);

      // /me (the response every tenant page loads) is clean too.
      const me = await app.request("/api/auth/me", {
        headers: { cookie: tenantAdminCookie() },
      });
      expect(await me.text()).not.toContain(SECRET_SENTINEL);
    } finally {
      await credsRepo.delete("linkedin");
    }
  });
});
