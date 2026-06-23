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
  RunCollectorsPayload,
  RunProcessJobPayload,
  RunState,
} from "@newsletter/shared";
import {
  collectorsFromSources,
  hasAnyCollector,
} from "@newsletter/shared/types";
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
  isTenantContext,
  scopedTenantId,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import { listRuns } from "@api/services/run-list.js";
import { captureAnalytics } from "@api/lib/posthog.js";

export interface RunsRouterDeps {
  redis: IORedis;
  publisher?: IORedis;
  processingQueue: Queue<RunProcessJobPayload>;
  getRawItemsRepo: (scope?: TenantScope) => RawItemsRepo;
  getSettingsRepo?: (scope?: TenantScope) => UserSettingsRepo;
  getArchiveRepo?: (scope?: TenantScope) => RunArchivesRepo;
  /** Tenant sources rows (P9, REQ-073) — drives /now's collection set. */
  getSourcesRepo?: (scope?: TenantScope) => SourcesRepo;
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
      {
        halfLifeHours: parsed.data.halfLifeHours,
        // P9 (REQ-060): stamp the session tenant onto the job payload.
        tenantId: scopedTenantId(tenantScopeFromContext(c)),
      },
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
    const scope = tenantScopeFromContext(c);
    const settingsRepo = deps.getSettingsRepo?.(scope);
    if (!settingsRepo) {
      return c.json({ error: "settings repository not configured" }, 500);
    }
    const settings = await settingsRepo.get();
    if (!settings) {
      return c.json({ error: "settings not configured" }, 409);
    }

    // P9 (REQ-073): once the tenant has `sources` ROWS, the collection set is
    // derived from the ENABLED rows and the legacy settings JSONB is ignored
    // (all rows disabled ⇒ nothing collects, even if JSONB says otherwise).
    // Tenants without rows keep the legacy JSONB path.
    let collectors: RunCollectorsPayload | undefined;
    const sourcesRepo = deps.getSourcesRepo?.(scope);
    if (sourcesRepo) {
      const rows = await sourcesRepo.list();
      if (rows.length > 0) {
        collectors = collectorsFromSources(
          rows.filter((row) => row.enabled).map((row) => row.config),
        );
        if (!hasAnyCollector(collectors)) {
          return c.json({ error: "no sources enabled" }, 409);
        }
      }
    }
    if (collectors === undefined) {
      const anySource =
        (settings.hnEnabled && settings.hnConfig !== null) ||
        (settings.redditEnabled && settings.redditConfig !== null) ||
        (settings.webEnabled && settings.webConfig !== null) ||
        (settings.twitterEnabled && settings.twitterConfig !== null) ||
        (settings.webSearchEnabled && settings.webSearchConfig !== null);
      if (!anySource) {
        return c.json({ error: "no sources enabled" }, 409);
      }
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

    const tenantId = scopedTenantId(scope);
    const { runId } = await startRun(
      settings,
      { redis: deps.redis, queue: deps.processingQueue },
      {
        dryRun,
        ...(collectors !== undefined ? { collectors } : {}),
        ...(tenantId !== undefined ? { tenantId } : {}),
      },
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
    const archiveRepo = deps.getArchiveRepo?.(tenantScopeFromContext(c));
    if (!archiveRepo) {
      return c.json({ error: "archive repository not configured" }, 500);
    }
    const settings = await deps.getSettingsRepo?.(tenantScopeFromContext(c)).get();
    const timezone = safeTimezone(settings?.scheduleTimezone);
    const runsList = await listRuns(limit, {
      redis: deps.redis,
      archiveRepo,
      timezone,
      // REQ-013: fence the Redis live-state entries to the session tenant.
      requesterScope: tenantScopeFromContext(c),
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
    // REQ-013: live run state is tenant-fenced — another tenant's runId
    // reads as not-found. Legacy states without a tenantId stay readable.
    const stateScope = tenantScopeFromContext(c);
    if (
      isTenantContext(stateScope) &&
      typeof state.tenantId === "string" &&
      state.tenantId !== stateScope.tenantId
    ) {
      return c.json({ error: "not found" }, 404);
    }
    if (state.status === "completed" && Array.isArray(state.rankedItems)) {
      const hydrated = await hydrateRankedItems(
        deps.getRawItemsRepo(tenantScopeFromContext(c)),
        state.rankedItems,
        null,
      );
      return c.json({ ...state, rankedItems: hydrated });
    }
    return c.json(state);
  });

  runs.post("/:runId/cancel", async (c) => {
    const runId = c.req.param("runId");
    const archiveRepo = deps.getArchiveRepo?.(tenantScopeFromContext(c));
    if (!archiveRepo) {
      return c.json({ error: "archive repository not configured" }, 500);
    }
    try {
      const run = await cancelRun(runId, {
        redis: deps.redis,
        publisher,
        archiveRepo,
        // REQ-013: a tenant can only cancel its own live runs.
        requesterScope: tenantScopeFromContext(c),
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

    const archiveRepo = deps.getArchiveRepo?.(tenantScopeFromContext(c));
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

    const settingsRepo = deps.getSettingsRepo?.();
    if (settingsRepo) {
      const settings = await settingsRepo.get();
      const channelEnabled =
        channel === "linkedin" ? settings?.linkedinEnabled : settings?.twitterPostEnabled;
      if (settings && channelEnabled === false) {
        return c.json(
          { error: "channel is not enabled", reason: "channel_disabled" },
          409,
        );
      }
    }

    const jobName = channel === "linkedin" ? "linkedin-post" : "twitter-post";
    // Social post jobs carry { runId, tenantId? } but share the processing
    // queue. Queue<RunProcessJobPayload> is structurally compatible via
    // BullMQ's base class — casting through the base QueueBase which exposes
    // an untyped add. tenantId (P9, REQ-060) scopes the publish deps.
    const postTenantId = scopedTenantId(tenantScopeFromContext(c));
    await (deps.processingQueue as Queue).add(jobName, {
      runId,
      ...(postTenantId !== undefined ? { tenantId: postTenantId } : {}),
    });

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

export function createDefaultRunsRouter(): Hono {
  return createRunsRouter({
    redis: createRedisConnection(),
    publisher: createRedisConnection(),
    processingQueue: getDefaultProcessingQueue(),
    getRawItemsRepo: (scope) => createRawItemsRepo(defaultGetDb(), scope),
    getSettingsRepo: (scope) => createUserSettingsRepo(defaultGetDb(), scope),
    getArchiveRepo: (scope) => createRunArchivesRepo(defaultGetDb(), scope),
    getSourcesRepo: (scope) => createSourcesRepo(defaultGetDb(), scope),
  });
}
