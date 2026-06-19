import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { verifyExtensionToken } from "./extension-token.js";

/**
 * Bearer-token gate for the extension's authenticated routes. Verifies the
 * `ext|`-namespaced HMAC and lifts the embedded `{ userId, tenantId, role }`
 * identity onto `tenantCtx` — the SAME context var the cookie `requireAuth`
 * sets — so every downstream repo tenant-scopes identically (REQ-020: the
 * tenant comes from the token, never the Host). Missing/invalid/expired → 401.
 */
export function requireExtensionAuth(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice("Bearer ".length);
    const payload = verifyExtensionToken(token, secret);
    if (payload === null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("tenantCtx", payload);
    await next();
  });
}
