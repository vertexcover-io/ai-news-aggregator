import { Hono } from "hono";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { TENANT_ZERO_SLUG } from "@newsletter/shared/constants/tenant";
import type {
  TenantContext,
  TenantScope,
} from "@newsletter/shared/types/tenant-context";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { tenantScopeFromPublicHost } from "@api/auth/tenant-scope.js";
import { resolvePostHogConfig } from "@newsletter/shared/analytics";

export interface AnalyticsConfigRouterDeps {
  /**
   * Settings repo for the Host-resolved public tenant. On the app host the
   * scope is undefined — the default factory then pins tenant 0 (AGENTLOOP):
   * an UNSCOPED get() would read an arbitrary tenant's row now that every
   * row carries `singleton = true` (0041 dropped the singleton unique).
   */
  getSettingsRepo: (scope?: TenantScope) => Pick<UserSettingsRepo, "get">;
}

export function createAnalyticsConfigRouter(
  deps: AnalyticsConfigRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await deps.getSettingsRepo(tenantScopeFromPublicHost(c)).get();
    return c.json(resolvePostHogConfig(settings));
  });

  return app;
}

export function createDefaultAnalyticsConfigRouter(): Hono {
  // Tenant 0's id never changes — resolve once, lazily.
  let tenantZeroScope: TenantContext | undefined;
  return createAnalyticsConfigRouter({
    getSettingsRepo: (scope) => ({
      get: async () => {
        if (scope === undefined && tenantZeroScope === undefined) {
          const tenantZero = await createTenantsRepo(defaultGetDb()).findBySlug(
            TENANT_ZERO_SLUG,
          );
          if (tenantZero !== null) {
            tenantZeroScope = { tenantId: tenantZero.id, role: "tenant_admin" };
          }
        }
        return createUserSettingsRepo(defaultGetDb(), scope ?? tenantZeroScope).get();
      },
    }),
  });
}
