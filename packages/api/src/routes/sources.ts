import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { buildSourcesSummary } from "@api/services/sources-summary.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";

export interface SourcesRouterDeps {
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  getSettingsRepo: () => UserSettingsRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicSourcesRouter(deps: SourcesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sources");
  const sources = new Hono();

  sources.get("/summary", async (c) => {
    try {
      const summary = await buildSourcesSummary({
        rawItemsRepo: deps.getRawItemsRepo(),
        runArchivesRepo: deps.getArchiveRepo(),
        userSettingsRepo: deps.getSettingsRepo(),
      });
      return c.json(summary);
    } catch (err) {
      logger.error({ err }, "sources.summary_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return sources;
}

export function createDefaultPublicSourcesRouter(): Hono {
  return createPublicSourcesRouter({
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
  });
}
