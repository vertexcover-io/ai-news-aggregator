import { Hono } from "hono";
import type IORedis from "ioredis";
import { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
  safeTimezone,
  startRun,
  runKey,
} from "@newsletter/shared";
import type {
  RunProcessJobPayload,
  RunState,
} from "@newsletter/shared";
import { AGENTLOOP_TENANT_ID, type TenantContext } from "@newsletter/shared/tenant";
import type { TenantVariables } from "@api/middleware/types.js";
import { runNowBodySchema, runSubmitSchema, socialChannelSchema } from "@api/lib/validate.js";
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
import { captureAnalytics } from "@api/lib/posthog.js";

export interface RunsRouterDeps {
  redis: IORedis;
  publisher?: IORedis;
  processingQueue: Queue<RunProcessJobPayload>;
  getRawItemsRepo: () => RawItemsRepo;
  getSettingsRepo?: () => UserSettingsRepo;
  getArchiveRepo?: () => RunArchivesRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createRunsRouter(
  deps: RunsRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const logger = deps.logger ?? createLogger("api:runs");
  const publisher = deps.publisher ?? deps.redis;
  const runs = new Hono<{ Variables: TenantVariables }>();

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
    void captureAnalytics({
      distinctId: "admin",
      event: "run_started",
      properties: { run_id: runId, top_n: parsed.data.topN, sources },
    });
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
      (settings.hnEnabled && settings.hnConfig !== null) ||
      (settings.redditEnabled && settings.redditConfig !== null) ||
      (settings.webEnabled && settings.webConfig !== null) ||
      (settings.twitterEnabled && settings.twitterConfig !== null) ||
      (settings.webSearchEnabled && settings.webSearchConfig !== null);
    if (!anySource) {
      return c.json({ error: "no sources enabled" }, 409);
    }

    // Body is optional — empty body / no body means a live run.
    // c.req.json() throws on an empty body, so treat that as `{}`.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }
    const parsed = runNowBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const dryRun = parsed.data.dryRun ?? false;

    const ctx: TenantContext = c.get("tenantCtx") ?? {
      tenantId: AGENTLOOP_TENANT_ID,
      role: "tenant_admin",
    };
    const { runId } = await startRun(
      settings,
      { redis: deps.redis, queue: deps.processingQueue },
      { dryRun, ctx },
    );
    logger.info(
      { event: "run.now", runId, topN: settings.topN, dryRun },
      "run.now",
    );
    void captureAnalytics({
      distinctId: "admin",
      event: "run_now_triggered",
      properties: { run_id: runId, top_n: settings.topN, dry_run: dryRun },
    });
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
    const settings = await deps.getSettingsRepo?.().get();
    const timezone = safeTimezone(settings?.scheduleTimezone);
    const runsList = await listRuns(limit, {
      redis: deps.redis,
      archiveRepo,
      timezone,
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
        null,
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
      void captureAnalytics({
        distinctId: "admin",
        event: "run_cancelled",
        properties: { run_id: runId },
      });
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

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  runs.post("/:runId/post/:channel", async (c) => {
    const rawChannel = c.req.param("channel");
    const channelResult = socialChannelSchema.safeParse(rawChannel);
    if (!channelResult.success) {
      return c.json({ error: `invalid channel: must be 'linkedin' or 'twitter'` }, 400);
    }
    const channel = channelResult.data;

    const runId = c.req.param("runId");
    if (!UUID_RE.test(runId)) {
      return c.json({ error: "invalid runId: must be a UUID" }, 400);
    }

    const archiveRepo = deps.getArchiveRepo?.();
    if (!archiveRepo) {
      return c.json({ error: "archive repository not configured" }, 500);
    }

    const archive = await archiveRepo.findById(runId);
    if (!archive) {
      return c.json({ error: "not found" }, 404);
    }

    if (archive.isDryRun) {
      return c.json({ error: "archive is not eligible for posting", reason: "dry_run" }, 409);
    }
    if (!archive.reviewed) {
      return c.json({ error: "archive is not eligible for posting", reason: "not_reviewed" }, 409);
    }
    if (archive.status !== "completed") {
      return c.json({ error: "archive is not eligible for posting", reason: "not_completed" }, 409);
    }
    const alreadyPosted =
      channel === "linkedin" ? archive.linkedinPostedAt !== null : archive.twitterPostedAt !== null;
    if (alreadyPosted) {
      return c.json({ error: "archive is already posted on this channel", reason: "already_posted" }, 409);
    }

    const jobName = channel === "linkedin" ? "linkedin-post" : "twitter-post";
    // Social post jobs carry only { runId } but share the processing queue.
    // Queue<RunProcessJobPayload> is structurally compatible via BullMQ's base class —
    // casting through the base QueueBase which exposes an untyped add.
    await (deps.processingQueue as Queue).add(jobName, { runId });

    logger.info({ event: "run.post.manual", runId, channel }, "run.post.manual");
    void captureAnalytics({
      distinctId: "admin",
      event: "run_post_manual_triggered",
      properties: { run_id: runId, channel },
    });
    return c.json({ runId }, 202);
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

export function createDefaultRunsRouter(): Hono<{ Variables: TenantVariables }> {
  return createRunsRouter({
    redis: createRedisConnection(),
    publisher: createRedisConnection(),
    processingQueue: getDefaultProcessingQueue(),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
  });
}
