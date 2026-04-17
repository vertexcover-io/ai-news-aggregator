import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { verifyToken, COOKIE_NAME } from "./session.js";

export function requireAdmin(secret: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token || !verifyToken(token, secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
}
