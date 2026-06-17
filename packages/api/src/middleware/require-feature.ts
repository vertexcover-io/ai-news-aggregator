/**
 * Feature-flag enforcement for admin-gated routes (Fix #4).
 *
 * Mounted after `requireAuth`, this guard reads the session tenant, loads its
 * row, and 403s `{ error: "feature_disabled", feature }` when the named flag is
 * off. The web app gates the matching route first (showing an in-app "enable in
 * Settings" notice), so this is defense in depth against direct API calls.
 *
 * A request with no concrete tenant (e.g. an all-tenants super_admin) is denied
 * too — those sessions never legitimately reach a tenant feature route.
 */
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";

export type FeatureFlag =
  | "featureEval"
  | "featureDeliverability"
  | "featureCanon";

export function createRequireFeature(
  getTenantsRepo: () => Pick<TenantsRepo, "findById">,
): (flag: FeatureFlag) => MiddlewareHandler {
  return (flag) =>
    createMiddleware(async (c, next) => {
      const tenantId = scopedTenantId(tenantScopeFromContext(c));
      if (tenantId === undefined) {
        return c.json({ error: "feature_disabled", feature: flag }, 403);
      }
      const tenant = await getTenantsRepo().findById(tenantId);
      if (!tenant?.[flag]) {
        return c.json({ error: "feature_disabled", feature: flag }, 403);
      }
      await next();
      return;
    });
}
