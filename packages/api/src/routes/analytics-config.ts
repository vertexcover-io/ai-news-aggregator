import { Hono } from "hono";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { resolvePostHogConfig } from "@newsletter/shared/analytics";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface AnalyticsConfigRouterDeps {
  getSettingsRepo: (ctx: TenantContext) => UserSettingsRepo;
}

export function createAnalyticsConfigRouter(
  deps: AnalyticsConfigRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await deps.getSettingsRepo(resolveTenantCtx(c)).get();
    return c.json(resolvePostHogConfig(settings));
  });

  return app;
}

export function createDefaultAnalyticsConfigRouter(): Hono {
  return createAnalyticsConfigRouter({
    getSettingsRepo: (ctx) => createUserSettingsRepo(defaultGetDb(), ctx),
  });
}
