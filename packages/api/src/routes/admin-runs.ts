import { Hono } from "hono";
import type IORedis from "ioredis";
import { z } from "zod";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { RunSourcesResponse } from "@newsletter/shared";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { NotFoundError } from "@api/lib/errors.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runIdSchema = z.string().regex(UUID_RE);

export interface AdminRunsRouterDeps {
  redis: IORedis;
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createAdminRunsRouter(deps: AdminRunsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:admin-runs");
  const app = new Hono();

  app.get("/:runId/sources", async (c) => {
    const runId = c.req.param("runId");
    const parsed = runIdSchema.safeParse(runId);
    if (!parsed.success) {
      return c.json({ error: "invalid runId" }, 400);
    }
    try {
      const items = await deps.getRawItemsRepo().listForRun(parsed.data, {
        archiveRepo: deps.getArchiveRepo(),
        redis: deps.redis,
      });
      const body: RunSourcesResponse = { runId: parsed.data, items };
      return c.json(body);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: "Run not found" }, 404);
      }
      logger.error({ err, runId: parsed.data }, "admin-runs.sources.failed");
      throw err;
    }
  });

  return app;
}

export function createDefaultAdminRunsRouter(): Hono {
  return createAdminRunsRouter({
    redis: createRedisConnection(),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
  });
}
