import { Hono } from "hono";
import type IORedis from "ioredis";
import { z } from "zod";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { RunObservability, RunSourcesResponse } from "@newsletter/shared";
import type { RunSourceItemsResponse } from "@newsletter/shared/types";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createRunLogRepo,
  type RunLogRepo,
} from "@api/repositories/run-logs.js";
import { buildRunObservability } from "@api/services/run-observability.js";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  buildRunSourceItems,
  InvalidSourceKeyError,
} from "@api/services/run-source-items.js";
import { NotFoundError } from "@api/lib/errors.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runIdSchema = z.string().regex(UUID_RE);

export interface AdminRunsRouterDeps {
  redis: IORedis;
  getRawItemsRepo: (scope?: TenantScope) => RawItemsRepo;
  getArchiveRepo: (scope?: TenantScope) => RunArchivesRepo;
  getRunLogRepo: (scope?: TenantScope) => RunLogRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createAdminRunsRouter(deps: AdminRunsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:admin-runs");
  const app = new Hono();

  app.get("/:runId/sources/:sourceKey/items", async (c) => {
    const runId = c.req.param("runId");
    const parsed = runIdSchema.safeParse(runId);
    if (!parsed.success) {
      return c.json({ error: "invalid runId" }, 400);
    }
    try {
      const body: RunSourceItemsResponse = await buildRunSourceItems(
        parsed.data,
        c.req.param("sourceKey"),
        {
          redis: deps.redis,
          archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
          rawItemsRepo: deps.getRawItemsRepo(tenantScopeFromContext(c)),
          runLogRepo: deps.getRunLogRepo(tenantScopeFromContext(c)),
          // REQ-013: fence the raw Redis run-state read to the session tenant.
          requesterScope: tenantScopeFromContext(c),
        },
      );
      return c.json(body);
    } catch (err) {
      if (err instanceof InvalidSourceKeyError) {
        return c.json({ error: "invalid sourceKey" }, 400);
      }
      if (err instanceof NotFoundError) {
        return c.json({ error: "Run not found" }, 404);
      }
      logger.error({ err, runId: parsed.data }, "admin-runs.source-items.failed");
      throw err;
    }
  });

  app.get("/:runId/sources", async (c) => {
    const runId = c.req.param("runId");
    const parsed = runIdSchema.safeParse(runId);
    if (!parsed.success) {
      return c.json({ error: "invalid runId" }, 400);
    }
    try {
      const items = await deps
        .getRawItemsRepo(tenantScopeFromContext(c))
        .listForRun(parsed.data, {
          archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
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

  app.get("/:runId/observability", async (c) => {
    const parsed = runIdSchema.safeParse(c.req.param("runId"));
    if (!parsed.success) {
      return c.json({ error: "invalid runId" }, 400);
    }
    try {
      const body: RunObservability = await buildRunObservability(parsed.data, {
        redis: deps.redis,
        archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
        runLogRepo: deps.getRunLogRepo(tenantScopeFromContext(c)),
        // REQ-013: fence the raw Redis run-state read to the session tenant.
        requesterScope: tenantScopeFromContext(c),
      });
      return c.json(body);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: "Run not found" }, 404);
      }
      logger.error({ err, runId: parsed.data }, "admin-runs.observability.failed");
      throw err;
    }
  });

  return app;
}

export function createDefaultAdminRunsRouter(): Hono {
  return createAdminRunsRouter({
    redis: createRedisConnection(),
    getRawItemsRepo: (scope) => createRawItemsRepo(defaultGetDb(), scope),
    getArchiveRepo: (scope) => createRunArchivesRepo(defaultGetDb(), scope),
    getRunLogRepo: (scope) => createRunLogRepo(defaultGetDb(), scope),
  });
}
