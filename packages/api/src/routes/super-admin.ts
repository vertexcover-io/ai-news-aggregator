import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  issueImpersonationToken,
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_MS,
} from "../auth/session.js";
import type { TenantsRepo } from "../repositories/tenants.js";

export interface SuperAdminRouterDeps {
  getTenantsRepo: () => TenantsRepo;
}

/**
 * Super-admin routes (Phase 6).
 *
 * Mounted under /api/super in app.ts behind requireAuth + requireSuperAdmin.
 * Requires SESSION_SECRET in the environment for token issuance.
 *
 * Routes:
 *   GET  /tenants              — list all tenants (REQ-100)
 *   POST /impersonate/:tenantId — start impersonating a tenant (REQ-101)
 *   POST /impersonate/exit      — stop impersonating, restore original context (REQ-102)
 */
export function createSuperAdminRouter(deps: SuperAdminRouterDeps): Hono {
  const app = new Hono();

  // REQ-100: List all tenants (super-admin only)
  app.get("/tenants", async (c) => {
    const tenants = await deps.getTenantsRepo().listAll();
    return c.json(tenants);
  });

  // REQ-102: Exit impersonation (MUST be before /:tenantId to avoid conflict)
  app.post("/impersonate/exit", (c) => {
    deleteCookie(c, IMPERSONATION_COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  // REQ-101: Start impersonation
  app.post("/impersonate/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (!tenant) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    const ctx = c.get("tenantCtx");
    const userId = ctx.userId;
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return c.json({ error: "Server misconfigured" }, 500);
    }

    const impToken = issueImpersonationToken(secret, {
      userId,
      actingTenantId: tenantId,
    });

    setCookie(c, IMPERSONATION_COOKIE_NAME, impToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(IMPERSONATION_MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });

    return c.json({ ok: true, tenantId, tenantName: tenant.name });
  });

  return app;
}
