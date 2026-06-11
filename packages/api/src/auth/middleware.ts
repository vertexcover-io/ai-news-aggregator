import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler, Context } from "hono";
import {
  verifyToken,
  verifySessionToken,
  COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "./session.js";
import type { SessionPayload } from "./session.js";

export interface TenantCtx {
  tenantId: string;
  userId: string;
  role: SessionPayload["role"];
}

/** Set tenant context on a Hono context. Works around strict Env typing. */
function setTenantCtx(c: Context, ctx: TenantCtx): void {
  (c.set as (key: string, value: unknown) => void)("tenantCtx", ctx);
  (c.set as (key: string, value: unknown) => void)("userId", ctx.userId);
}

/** Get tenant context from a Hono context. */
export function getTenantCtx(c: Context): TenantCtx {
  return (c.get as (key: string) => unknown)("tenantCtx") as TenantCtx;
}

/**
 * Legacy middleware — accepts BOTH old admin|ts tokens AND new session tokens.
 * Keep until P6 (super-admin seed + impersonation) lands.
 */
export function requireAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    // Try new session cookie first
    const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
    if (sessionToken) {
      const payload = verifySessionToken(sessionToken, secret);
      if (payload) {
        setTenantCtx(c, {
          tenantId: payload.tenantId,
          userId: payload.userId,
          role: payload.role,
        } satisfies TenantCtx);
        return next();
      }
    }

    // Fall back to old admin_session cookie
    const legacyToken = getCookie(c, COOKIE_NAME);
    if (legacyToken && verifyToken(legacyToken, secret)) {
      return next();
    }

    return c.json({ error: "unauthorized" }, 401);
  });
}

/**
 * Requires a valid session cookie. Populates c.var.tenantCtx.
 * Used by tenant-scoped routes.
 */
export function requireAuth(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const payload = verifySessionToken(token, secret);
    if (!payload) {
      return c.json({ error: "unauthorized" }, 401);
    }
    setTenantCtx(c, {
      tenantId: payload.tenantId,
      userId: payload.userId,
      role: payload.role,
    } satisfies TenantCtx);
    await next();
  });
}

/**
 * Requires a valid session cookie with role === 'super_admin'.
 */
export function requireSuperAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const payload = verifySessionToken(token, secret);
    if (payload?.role !== "super_admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    setTenantCtx(c, {
      tenantId: payload.tenantId,
      userId: payload.userId,
      role: payload.role,
    } satisfies TenantCtx);
    await next();
  });
}
