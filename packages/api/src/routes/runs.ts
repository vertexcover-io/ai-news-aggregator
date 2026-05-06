import { Hono } from "hono";
import type IORedis from "ioredis";
import { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
  startRun,
  runKey,
} from "@newsletter/shared";
import type {
  RunProcessJobPayload,
  RunState,
} from "@newsletter/shared";
import { runSubmitSchema } from "@api/lib/validate.js";
import { createRun } from "@api/services/runs.js";
import {
  cancelRun,
  CancelNotFoundError,
  CancelConflictError,
} from "@api/services/cancel-run.js";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
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
import { listRuns } from "@api/services/run-list.js";

export interface RunsRouterDeps {
  redis: IORedis;
  publisher?: IORedis;
  processingQueue: Queue<RunProcessJobPayload>;
  getRawItemsRepo: () => RawItemsRepo;
  getSettingsRepo?: () => UserSettingsRepo;
  getArchiveRepo?: () => RunArchivesRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:runs");
  const publisher = deps.publisher ?? deps.redis;
  const runs = new Hono();

  runs.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = runSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { runId } = await createRun(
      parsed.data,
      deps.redis,
      deps.processingQueue,
      { halfLifeHours: parsed.data.halfLifeHours },
    );
    const sources = Object.keys(parsed.data).filter(
      (k) => k !== "topN" && k !== "halfLifeHours",
    );
    logger.info(
      { event: "run.started", runId, topN: parsed.data.topN, sources },
      "run.started",
    );
    return c.json({ runId }, 201);
  });

  runs.post("/now", async (c) => {
    const settingsRepo = deps.getSettingsRepo?.();
    if (!settingsRepo) {
      return c.json({ error: "settings repository not configured" }, 500);
    }
    const settings = await settingsRepo.get();
    if (!settings) {
      return c.json({ error: "settings not configured" }, 409);
    }
    const anySource =
      settings.hnConfig !== null ||
      settings.redditConfig !== null ||
      settings.webConfig !== null ||
      settings.twitterConfig !== null;
    if (!anySource) {
      return c.json({ error: "no sources enabled" }, 409);
    }
    const { runId } = await startRun(settings, {
      redis: deps.redis,
      queue: deps.processingQueue,
    });
    logger.info(
      { event: "run.now", runId, topN: settings.topN },
      "run.now",
    );
    return c.json({ runId }, 202);
  });

  runs.get("/", async (c) => {
    const limitRaw = c.req.query("limit");
    let limit = 30;
    if (limitRaw !== undefined) {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return c.json(
          { error: "limit must be an integer between 1 and 100" },
          400,
        );
      }
      limit = parsed;
    }
    const archiveRepo = deps.getArchiveRepo?.();
    if (!archiveRepo) {
      return c.json({ error: "archive repository not configured" }, 500);
    }
    const runsList = await listRuns(limit, {
      redis: deps.redis,
      archiveRepo,
    });
    return c.json({ runs: runsList });
  });

  runs.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    const raw = await deps.redis.get(runKey(runId));
    if (raw === null) {
      return c.json({ error: "not found" }, 404);
    }
    const state = JSON.parse(raw) as RunState;
    if (state.status === "completed" && Array.isArray(state.rankedItems)) {
      const hydrated = await hydrateRankedItems(
        deps.getRawItemsRepo(),
        state.rankedItems,
      );
      return c.json({ ...state, rankedItems: hydrated });
    }
    return c.json(state);
  });

  runs.post("/:runId/cancel", async (c) => {
    const runId = c.req.param("runId");
    const archiveRepo = deps.getArchiveRepo?.();
    if (!archiveRepo) {
      return c.json({ error: "archive repository not configured" }, 500);
    }
    try {
      const run = await cancelRun(runId, {
        redis: deps.redis,
        publisher,
        archiveRepo,
      });
      logger.info({ event: "run.cancelling", runId }, "run.cancelling");
      return c.json({ run });
    } catch (err) {
      if (err instanceof CancelNotFoundError) {
        return c.json({ error: "not found" }, 404);
      }
      if (err instanceof CancelConflictError) {
        return c.json(
          { error: "run is not cancellable", status: err.currentStatus },
          409,
        );
      }
      throw err;
    }
  });

  return runs;
}

let defaultProcessingQueue: Queue<RunProcessJobPayload> | null = null;

function getDefaultProcessingQueue(): Queue<RunProcessJobPayload> {
  defaultProcessingQueue ??= new Queue<RunProcessJobPayload>("processing", {
    connection: createRedisConnection(),
  });
  return defaultProcessingQueue;
}

export function createDefaultRunsRouter(): Hono {
  return createRunsRouter({
    redis: createRedisConnection(),
    publisher: createRedisConnection(),
    processingQueue: getDefaultProcessingQueue(),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
  });
}
