import type { Context } from "hono";
import type { TenantContext } from "@newsletter/shared/tenant";

export type { TenantVariables } from "./types.js";

export function getTenantCtx(c: Context): TenantContext {
  const ctx = c.get("tenantCtx") as TenantContext | undefined;
  if (!ctx) throw new Error("tenant context not set");
  return ctx;
}
