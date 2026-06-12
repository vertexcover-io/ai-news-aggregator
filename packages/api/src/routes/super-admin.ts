import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { requireSuperAdmin } from "@api/auth/middleware.js";
import {
  COOKIE_NAME,
  MAX_AGE_MS,
  verifySession,
  withImpersonation,
  withoutImpersonation,
  type SessionClaims,
} from "@api/auth/session.js";
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";
import {
  createImpersonationEventsRepo,
  type ImpersonationEventsRepo,
} from "@api/repositories/impersonation-events.js";

export interface SuperAdminRouterDeps {
  sessionSecret: string;
  getTenantsRepo: () => Pick<TenantsRepo, "list" | "findById">;
  getImpersonationEventsRepo: () => Pick<ImpersonationEventsRepo, "record">;
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Super-admin surface (REQ-100..103). The reissued cookie only ever gains or
 * loses the `imp` claim — uid/tid/role/iat are preserved, so impersonation
 * never extends the session window and the role stays super_admin (no
 * elevated tenant powers: tenant routes see tenantId = imp and nothing else,
 * EDGE-008).
 */
export function createSuperAdminRouter(deps: SuperAdminRouterDeps): Hono {
  const app = new Hono();
  app.use("*", requireSuperAdmin(deps.sessionSecret));

  // The middleware already verified the cookie; re-verify here to get the raw
  // claims (incl. iat) needed for a faithful reissue.
  const claimsFrom = (c: Context): SessionClaims | null => {
    const token = getCookie(c, COOKIE_NAME);
    return token ? verifySession(token, deps.sessionSecret) : null;
  };

  app.get("/tenants", async (c) => {
    const tenants = await deps.getTenantsRepo().list();
    return c.json({
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  app.post("/impersonate/:tenantId", async (c) => {
    const claims = claimsFrom(c);
    if (!claims) return c.json({ error: "unauthorized" }, 401);

    const tenant = await deps.getTenantsRepo().findById(c.req.param("tenantId"));
    if (!tenant) return c.json({ error: "not_found" }, 404);

    const audit = deps.getImpersonationEventsRepo();
    // Switching tenants without an explicit exit still closes the old span.
    if (claims.imp !== undefined && claims.imp !== tenant.id) {
      await audit.record(claims.uid, claims.imp, "stop");
    }
    // REQ-103: audit BEFORE the cookie reissue — if the audit write fails, the
    // 500 must not carry an (unaudited) impersonation cookie.
    await audit.record(claims.uid, tenant.id, "start");
    setSessionCookie(c, withImpersonation(claims, tenant.id, deps.sessionSecret));
    return c.json({
      impersonating: true,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      },
    });
  });

  app.post("/exit-impersonation", async (c) => {
    const claims = claimsFrom(c);
    if (!claims) return c.json({ error: "unauthorized" }, 401);

    // Idempotent: exiting while not impersonating is a no-op (no audit row).
    if (claims.imp === undefined) return c.json({ impersonating: false });

    await deps.getImpersonationEventsRepo().record(claims.uid, claims.imp, "stop");
    setSessionCookie(c, withoutImpersonation(claims, deps.sessionSecret));
    return c.json({ impersonating: false });
  });

  return app;
}

export function createDefaultSuperAdminRouter(sessionSecret: string): Hono {
  return createSuperAdminRouter({
    sessionSecret,
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    getImpersonationEventsRepo: () =>
      createImpersonationEventsRepo(defaultGetDb()),
  });
}
