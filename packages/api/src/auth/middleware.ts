import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import {
  verifyToken,
  verifyImpersonationToken,
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
  type SessionPayload,
} from "./session.js";

/**
 * Request-scoped tenant context derived from the session cookie (REQ-005/011).
 * `impersonating` is set only while a super_admin session carries a valid
 * impersonation cookie (P6, REQ-101) — `tenantId` then holds the ACTING
 * tenant while `userId` stays the super admin's (audit, REQ-103).
 */
export type TenantCtx = SessionPayload & { impersonating?: boolean };

declare module "hono" {
  interface ContextVariableMap {
    tenantCtx: TenantCtx;
  }
}

/**
 * Applies a valid impersonation cookie to a super_admin session: the
 * tenantCtx swaps to the acting tenant and is flagged `impersonating`.
 * The cookie is ignored (never an error) for non-super sessions, a userId
 * mismatch, or an invalid/expired token — and it can NEVER authenticate a
 * request by itself (requireAuth still demands the session cookie). Role is
 * unchanged, but because tenantId becomes non-null the repo-scope bridge
 * yields a concrete tenant-fenced scope, not withAllTenants — impersonation
 * grants no privilege beyond a tenant admin (EDGE-008).
 */
function applyImpersonation(
  c: Context,
  session: SessionPayload,
  secret: string,
): TenantCtx {
  if (session.role !== "super_admin") return session;
  const token = getCookie(c, IMPERSONATION_COOKIE_NAME);
  const impersonation = token ? verifyImpersonationToken(token, secret) : null;
  if (impersonation?.userId !== session.userId) {
    return session;
  }
  return {
    userId: session.userId,
    tenantId: impersonation.actingTenantId,
    role: session.role,
    impersonating: true,
  };
}

/**
 * Cookie gate for authenticated routes: verifies the HMAC session token and
 * populates `c.get("tenantCtx")` with `{ userId, tenantId, role }`.
 * Missing/invalid/expired token → 401 (REQ-007).
 */
export function requireAuth(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    const payload = token ? verifyToken(token, secret) : null;
    if (payload === null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("tenantCtx", applyImpersonation(c, payload, secret));
    await next();
  });
}

/** requireAuth + role check: authenticated non-super_admin sessions get 403. */
export function requireSuperAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    const payload = token ? verifyToken(token, secret) : null;
    if (payload === null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (payload.role !== "super_admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("tenantCtx", payload);
    await next();
  });
}
