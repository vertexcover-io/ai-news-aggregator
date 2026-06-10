import { Hono } from "hono";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { resolvePostHogConfig } from "@newsletter/shared/analytics";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";

export interface AnalyticsConfigRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
}

export function createAnalyticsConfigRouter(
  deps: AnalyticsConfigRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await deps.getSettingsRepo().get();
    return c.json(resolvePostHogConfig(settings));
  });

  return app;
}

export function createDefaultAnalyticsConfigRouter(): Hono {
  return createAnalyticsConfigRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb(), BOOTSTRAP_CONTEXT),
  });
}

