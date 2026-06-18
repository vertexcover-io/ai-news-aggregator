import type { MiddlewareHandler } from "hono";
import { verifyExtensionToken } from "./extension-token.js";

export function requireExtensionAuth(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice("Bearer ".length);
    if (!verifyExtensionToken(token, secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
