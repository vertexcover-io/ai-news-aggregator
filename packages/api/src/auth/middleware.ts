import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import {
  agentloopContext,
  type TenantContext,
} from "@newsletter/shared/tenant";
import { verifySession, verifyToken, COOKIE_NAME } from "./session.js";

export function requireAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const session = verifySession(token, secret);
    if (session) {
      const ctx: TenantContext = {
        tenantId: session.tenantId,
        userId: session.userId,
        role: session.role,
      };
      c.set("tenantCtx", ctx);
      await next();
      return;
    }
    if (verifyToken(token, secret)) {
      c.set("tenantCtx", agentloopContext());
      await next();
      return;
    }
    return c.json({ error: "unauthorized" }, 401);
  });
}
