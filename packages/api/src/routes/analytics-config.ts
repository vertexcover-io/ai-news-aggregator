import { Hono } from "hono";
import { getTenantId } from "@api/middleware/tenant-host.js";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { resolvePostHogConfig } from "@newsletter/shared/analytics";

export interface AnalyticsConfigRouterDeps {
  getSettingsRepo: (tenantId: string) => UserSettingsRepo;
}

export function createAnalyticsConfigRouter(
  deps: AnalyticsConfigRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await deps.getSettingsRepo(getTenantId(c)).get();
    return c.json(resolvePostHogConfig(settings));
  });

  return app;
}

export function createDefaultAnalyticsConfigRouter(): Hono {
  return createAnalyticsConfigRouter({
    getSettingsRepo: (tenantId) => createUserSettingsRepo(defaultGetDb(), tenantId),
  });
}

