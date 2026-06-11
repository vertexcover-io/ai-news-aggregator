/**
 * Super-admin console backend (P6, REQ-100/101/102/103, EDGE-008):
 *
 *   GET  /tenants               — list every tenant (summary fields only)
 *   POST /impersonate/:tenantId — start audited impersonation (sets the
 *                                 short-lived impersonation cookie)
 *   POST /impersonate/exit      — stop impersonation (audited, idempotent)
 *
 * ALL routes sit behind requireSuperAdmin (applied inside this factory so no
 * mounting mistake can expose them). Impersonation is a SEPARATE short-lived
 * HMAC token carried alongside the super admin's session cookie — the
 * session keeps the original identity for audit (REQ-103) and the swap never
 * widens privileges beyond a tenant admin (EDGE-008; see auth/middleware.ts).
 *
 * Serializers expose only summary fields — never logoBytes or any credential
 * material (REQ-082/NF6).
 */
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { SessionTenant } from "@newsletter/shared/types/tenant";
import { requireSuperAdmin } from "@api/auth/middleware.js";
import {
  issueImpersonationToken,
  verifyImpersonationToken,
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_MS,
} from "@api/auth/session.js";
import type { TenantsRepo, TenantRow } from "@api/repositories/tenants.js";
import type { AuditLogRepo } from "@api/repositories/audit-log.js";

export interface SuperAdminRouterDeps {
  sessionSecret: string;
  getTenantsRepo: () => Pick<TenantsRepo, "findById" | "listAll">;
  getAuditLogRepo: () => AuditLogRepo;
}

export interface TenantSummary extends SessionTenant {
  /** ISO timestamp. */
  createdAt: string;
}

/** Summary projection — explicitly NEVER the raw row (no logoBytes, NF6). */
function toTenantSummary(row: TenantRow): TenantSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSuperAdminRouter(deps: SuperAdminRouterDeps): Hono {
  const app = new Hono();
  app.use("*", requireSuperAdmin(deps.sessionSecret));

  app.get("/tenants", async (c) => {
    const rows = await deps.getTenantsRepo().listAll();
    return c.json({ tenants: rows.map(toTenantSummary) });
  });

  app.post("/impersonate/exit", async (c) => {
    const ctx = c.get("tenantCtx");
    const token = getCookie(c, IMPERSONATION_COOKIE_NAME);
    const impersonation = token
      ? verifyImpersonationToken(token, deps.sessionSecret)
      : null;
    // Audit the stop only for a live impersonation owned by this session;
    // clearing the cookie itself is idempotent (REQ-102).
    if (impersonation !== null && impersonation.userId === ctx.userId) {
      await deps.getAuditLogRepo().record({
        action: "impersonation_stop",
        actorUserId: ctx.userId,
        tenantId: impersonation.actingTenantId,
      });
    }
    deleteCookie(c, IMPERSONATION_COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/impersonate/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    if (!UUID_RE.test(tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) {
      return c.json({ error: "not_found" }, 404);
    }
    const ctx = c.get("tenantCtx");
    await deps.getAuditLogRepo().record({
      action: "impersonation_start",
      actorUserId: ctx.userId,
      tenantId: tenant.id,
    });
    const token = issueImpersonationToken(
      {
        userId: ctx.userId,
        role: "super_admin",
        actingTenantId: tenant.id,
        impersonating: true,
      },
      deps.sessionSecret,
    );
    setCookie(c, IMPERSONATION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(IMPERSONATION_MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });
    return c.json({ ok: true, tenant: toTenantSummary(tenant) });
  });

  return app;
}
