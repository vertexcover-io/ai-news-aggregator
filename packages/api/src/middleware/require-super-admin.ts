import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { TenantVariables } from "./types.js";

export function requireSuperAdmin(): MiddlewareHandler<{
  Variables: TenantVariables;
}> {
  return createMiddleware<{ Variables: TenantVariables }>(async (c, next) => {
    const ctx = c.get("tenantCtx");
    if (ctx?.role !== "super_admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });
}
