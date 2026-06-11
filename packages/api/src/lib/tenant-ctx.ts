import type { Context } from "hono";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { BOOTSTRAP_TENANT_ID } from "@newsletter/shared/types/tenant-context";

/**
 * Resolve TenantContext from a Hono request context.
 * When the auth middleware (Phase 3) is active, it sets `c.var.tenantCtx`.
 * Until then, falls back to BOOTSTRAP_TENANT_ID for development.
 *
 * NEVER use this in production without the auth middleware active.
 */
export function resolveTenantCtx(c: Context): TenantContext {
  const fromMiddleware = (c.var as Record<string, unknown>).tenantCtx as TenantContext | undefined;
  if (fromMiddleware) return fromMiddleware;

  return {
    tenantId: BOOTSTRAP_TENANT_ID,
    role: "super_admin",
  };
}
