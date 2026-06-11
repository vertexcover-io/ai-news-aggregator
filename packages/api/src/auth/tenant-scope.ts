/**
 * Bridges the session payload (P3 cookie: { userId, tenantId, role }) to the
 * repository TenantScope seam (P4, REQ-011/126).
 *
 * - tenant_admin → concrete TenantContext (every repo query tenant-fenced)
 * - super_admin (tenantId null) → withAllTenants() escape hatch — only
 *   reachable through requireAuth/requireSuperAdmin-gated handlers
 * - no session (unit tests, public routes pre-P5) → undefined (legacy
 *   single-tenant mode)
 */
import type { Context } from "hono";
import {
  withAllTenants,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import type { TenantCtx } from "./middleware.js";

export function tenantScopeFromSession(
  session: TenantCtx | undefined,
): TenantScope | undefined {
  if (session === undefined) return undefined;
  if (session.tenantId !== null) {
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      role: session.role,
      // Impersonating super_admins land here too (tenantId = acting tenant):
      // a concrete tenant fence, never withAllTenants (EDGE-008).
      ...(session.impersonating === true ? { impersonating: true } : {}),
    };
  }
  if (session.role === "super_admin") return withAllTenants(session);
  return undefined;
}

/** Reads `tenantCtx` (set by requireAuth) off the Hono context. */
export function tenantScopeFromContext(c: Context): TenantScope | undefined {
  return tenantScopeFromSession(c.get("tenantCtx"));
}

/**
 * Repository scope for PUBLIC routes, derived from the Host-resolved tenant
 * (`publicTenant`, set by the P5 resolver — P7, REQ-044). Returns a concrete
 * single-tenant fence so cross-host resource ids read as not-found; on the
 * app host / local dev no public tenant exists → undefined (legacy
 * single-tenant mode, same data as today). The role is nominal — repositories
 * only consume `tenantId` — and this scope never grants write paths anything:
 * public routes are read-only.
 */
export function tenantScopeFromPublicHost(c: Context): TenantScope | undefined {
  const publicTenant = c.get("publicTenant");
  if (publicTenant === undefined) return undefined;
  return { tenantId: publicTenant.tenantId, role: "tenant_admin" };
}
