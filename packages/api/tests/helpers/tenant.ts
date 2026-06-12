import type { MiddlewareHandler } from "hono";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";

export const TEST_TENANT_ID = TENANT_ZERO_ID;

/** Sets the public-tenant context the way createPublicTenantMiddleware would,
 * so route unit tests can exercise handlers without a real Host header. */
export function setTestTenant(tenantId: string = TEST_TENANT_ID): MiddlewareHandler {
  return async (c, next) => {
    c.set("publicTenant", { tenantId, slug: null });
    await next();
  };
}
