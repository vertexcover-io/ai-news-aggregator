import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import {
  verifyToken,
  verifySessionToken,
  verifyImpersonationToken,
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
} from "./session.js";
import type { SessionPayload } from "./session.js";

// ── Declare the context variable for type safety ────────────────────────
// Set via c.set("tenantCtx", ...) in middleware.

/** Extended tenantCtx payload — includes impersonation state (Phase 6). */
export interface TenantCtxPayload extends SessionPayload {
  /** When a super_admin is impersonating a tenant, this is true. */
  impersonating?: true;
  /** When impersonating, the original super_admin role for audit trail. */
  originalRole?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    tenantCtx: TenantCtxPayload;
  }
}

/**
 * Legacy admin auth — checks for a valid legacy token.
 * Retained for backwards compatibility until the full migration.
 */
export function requireAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token || !verifyToken(token, secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
}

/**
 * Require a valid session (V2 token or legacy token).
 * Populates c.var.tenantCtx with { userId, tenantId, role }.
 */
export function requireAuth(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // Try V2 token first
    const payload = verifySessionToken(token, secret);
    if (payload) {
      c.set("tenantCtx", payload);
      await next();
      return;
    }

    // Fall back to legacy token
    if (verifyToken(token, secret)) {
      // Legacy tokens have no payload — set a default tenant context.
      // In practice, legacy login should redirect to the new auth flow.
      c.set("tenantCtx", {
        userId: "",
        tenantId: "",
        role: "tenant_admin",
      });
      await next();
      return;
    }

    return c.json({ error: "unauthorized" }, 401);
  });
}

/**
 * Read an active impersonation cookie and swap tenantCtx if valid.
 * Must run AFTER requireAuth so tenantCtx is already populated from
 * the session cookie before we swap it.
 *
 * On a valid impersonation cookie:
 *   tenantCtx.tenantId = actingTenantId
 *   tenantCtx.role = "tenant_admin" (downgrade)
 *   tenantCtx.impersonating = true
 *   tenantCtx.originalRole = session.role (for audit)
 *
 * REQ-101, EDGE-008: no privilege elevation — impersonation swaps tenant
 * context but does NOT grant super_admin role to the request.
 */
export function requireImpersonation(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const impToken = getCookie(c, IMPERSONATION_COOKIE_NAME);
    if (!impToken) {
      await next();
      return;
    }

    const impPayload = verifyImpersonationToken(impToken, secret);
    if (!impPayload) {
      // Expired or invalid impersonation — ignore, fall through to normal auth
      await next();
      return;
    }

    // Swap the tenantCtx: impersonate the target tenant.
    // The original userId and role are preserved for audit,
    // but tenantId becomes actingTenantId, role downgraded, impersonating=true.
    const existingCtx = c.get("tenantCtx");
    // Double-check: only swap if the existing session userId matches the
    // impersonation token's userId (defense-in-depth against cross-user forgery)
    if (existingCtx.userId !== impPayload.userId) {
      await next();
      return;
    }

    c.set("tenantCtx", {
      userId: impPayload.userId,
      tenantId: impPayload.actingTenantId,
      role: "tenant_admin",
      impersonating: true as const,
      originalRole: existingCtx.role,
    });

    await next();
  });
}

/**
 * Require super_admin role.
 * Must be used AFTER requireAuth so tenantCtx is populated.
 *
 * EDGE-008: When impersonating (impersonating === true), role is "tenant_admin"
 * so this middleware naturally blocks impersonated sessions — no privilege elevation.
 */
export function requireSuperAdmin(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const ctx = c.get("tenantCtx");
    if (ctx.role !== "super_admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });
}
