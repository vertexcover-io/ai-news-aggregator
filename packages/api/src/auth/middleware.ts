import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { verifyToken, COOKIE_NAME, type SessionPayload } from "./session.js";

/** Request-scoped tenant context derived from the session cookie (REQ-005/011). */
export type TenantCtx = SessionPayload;

declare module "hono" {
  interface ContextVariableMap {
    tenantCtx: TenantCtx;
  }
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
    c.set("tenantCtx", payload);
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
