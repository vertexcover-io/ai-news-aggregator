import { Hono } from "hono";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { z } from "zod";
import {
  createLogger,
  getDb as defaultGetDb,
  createRedisConnection,
  formatDateInTimezone,
  safeTimezone,
} from "@newsletter/shared";
import type {
  ArchiveListResponse,
  RunState,
} from "@newsletter/shared";
import { Queue as BullQueue } from "bullmq";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchiveRow,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  archivePatchSchema,
  addPostSchema,
  promoteSchema,
} from "@api/lib/validate.js";
import {
  patchArchive,
  addPostToArchive,
  getPool,
  promoteItem,
  NotFoundError,
  ValidationError,
  ConflictError,
  type HydrateAddedPostFn,
  type GenerateRecapFn,
  type GenerateDigestFn,
} from "@api/services/review.js";
import { captureAnalytics } from "@api/lib/posthog.js";
import { generateReviewDigest } from "@api/services/review-digest.js";

export interface ArchivesRouterDeps {
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  getSettingsRepo?: () => Pick<UserSettingsRepo, "get">;
  hydrateAddedPost?: HydrateAddedPostFn;
  generateRecapFn?: GenerateRecapFn;
  generateDigestFn?: GenerateDigestFn;
  logger?: ReturnType<typeof createLogger>;
  processingQueue?: Pick<Queue, "add">;
  redis?: Pick<IORedis, "del">;
}

async function getConfiguredTimezone(
  deps: Pick<ArchivesRouterDeps, "getSettingsRepo">,
): Promise<string> {
  if (deps.getSettingsRepo === undefined) return "UTC";
  const settings = await deps.getSettingsRepo().get();
  return safeTimezone(settings?.scheduleTimezone);
}

function getIssueDate(
  archive: Pick<RunArchiveRow, "startedAt" | "completedAt">,
  timezone: string,
): string {
  return formatDateInTimezone(archive.startedAt ?? archive.completedAt, timezone);
}

export function createPublicArchivesRouter(deps: ArchivesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:archives");
  const archives = new Hono();

  archives.get("/", async (c) => {
    const timezone = await getConfiguredTimezone(deps);
    const items = await deps.getArchiveRepo().listReviewed({
      rawItemsRepo: deps.getRawItemsRepo(),
      timezone,
    });
    return c.json({ archives: items } satisfies ArchiveListResponse);
  });

  archives.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    try {
      const archive = await deps.getArchiveRepo().findById(runId);
      if (!archive) return c.json({ error: "not found" }, 404);
      if (!archive.reviewed) return c.json({ error: "not found" }, 404);
      const timezone = await getConfiguredTimezone(deps);

      const state: RunState & {
        sourceTypes: string[] | null;
        digestHeadline: string | null;
        digestSummary: string | null;
        hook: string | null;
      } = {
        id: runId,
        status: archive.status,
        stage: archive.status === "completed" ? "completed" : "failed",
        topN: archive.topN,
        startedAt: archive.startedAt?.toISOString() ?? archive.completedAt.toISOString(),
        issueDate: getIssueDate(archive, timezone),
        updatedAt: archive.completedAt.toISOString(),
        completedAt: archive.completedAt.toISOString(),
        sources: {},
        rankedItems: archive.rankedItems,
        warnings: [],
        error: null,
        sourceTypes: archive.sourceTypes,
        digestHeadline: archive.digestHeadline,
        digestSummary: archive.digestSummary,
        hook: archive.hook,
      };

      if (archive.status === "completed" && Array.isArray(archive.rankedItems)) {
        const hydrated = await hydrateRankedItems(
          deps.getRawItemsRepo(),
          archive.rankedItems,
        );
        return c.json({ ...state, rankedItems: hydrated });
      }

      return c.json(state);
    } catch (err) {
      logger.error({ err, runId }, "archive.fetch_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return archives;
}

export function createAdminArchivesRouter(deps: ArchivesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:archives");
  const archives = new Hono();

  archives.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    try {
      const archive = await deps.getArchiveRepo().findById(runId);
      if (!archive) return c.json({ error: "not found" }, 404);
      const timezone = await getConfiguredTimezone(deps);

      const state: RunState & {
        sourceTypes: string[] | null;
        digestHeadline: string | null;
        digestSummary: string | null;
        hook: string | null;
        isDryRun: boolean;
      } = {
        id: runId,
        status: archive.status,
        stage: archive.status === "completed" ? "completed" : "failed",
        topN: archive.topN,
        startedAt: archive.startedAt?.toISOString() ?? archive.completedAt.toISOString(),
        issueDate: getIssueDate(archive, timezone),
        updatedAt: archive.completedAt.toISOString(),
        completedAt: archive.completedAt.toISOString(),
        sources: {},
        rankedItems: archive.rankedItems,
        warnings: [],
        error: null,
        sourceTypes: archive.sourceTypes,
        digestHeadline: archive.digestHeadline,
        digestSummary: archive.digestSummary,
        hook: archive.hook,
        isDryRun: archive.isDryRun,
      };

      if (archive.status === "completed" && Array.isArray(archive.rankedItems)) {
        const hydrated = await hydrateRankedItems(
          deps.getRawItemsRepo(),
          archive.rankedItems,
        );
        return c.json({ ...state, rankedItems: hydrated });
      }

      return c.json(state);
    } catch (err) {
      logger.error({ err, runId }, "admin.archive.fetch_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  archives.patch("/:runId", async (c) => {
    const runId = c.req.param("runId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = archivePatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    try {
      const updated = await patchArchive(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(),
        rawItemsRepo: deps.getRawItemsRepo(),
        generateDigestFn: deps.generateDigestFn ?? createDefaultGenerateDigestFn(),
      });
      logger.info(
        { event: "archive.patched", runId, count: parsed.data.rankedItems.length },
        "archive.patched",
      );
      void captureAnalytics({
        distinctId: "admin",
        event: "archive_reviewed",
        properties: { run_id: runId, item_count: parsed.data.rankedItems.length },
      });
      return c.json(updated);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, missingIds: err.missingIds }, 400);
      }
      throw err;
    }
  });

  archives.post("/:runId/send", async (c) => {
    const runId = c.req.param("runId");
    const archive = await deps.getArchiveRepo().findById(runId);
    if (!archive) return c.json({ error: "not found" }, 404);
    if (deps.processingQueue) {
      await deps.processingQueue.add(
        "email-send",
        { runId },
        { jobId: `email-send:${runId}`, delay: 0 },
      );
      logger.info(
        { event: "archive.send_enqueued", runId, trigger: "force-send" },
        "archive: email-send job enqueued (force-send)",
      );
      void captureAnalytics({
        distinctId: "admin",
        event: "newsletter_send_enqueued",
        properties: { run_id: runId, trigger: "force-send" },
      });
    }
    return c.json({ ok: true }, 202);
  });

  archives.post("/:runId/add-post", async (c) => {
    const runId = c.req.param("runId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = addPostSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    try {
      const ranked = await addPostToArchive(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(),
        rawItemsRepo: deps.getRawItemsRepo(),
        hydrateAddedPost: deps.hydrateAddedPost,
      });
      logger.info(
        { event: "archive.add-post", runId },
        "archive.add-post",
      );
      void captureAnalytics({
        distinctId: "admin",
        event: "post_added_to_archive",
        properties: { run_id: runId },
      });
      return c.json(ranked);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ConflictError) {
        return c.json({ error: err.message }, 409);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : "upstream error";
      logger.warn(
        {
          event: "archive.add-post.upstream-failure",
          runId,
          error: message,
        },
        "archive.add-post.upstream-failure",
      );
      return c.json(
        { error: `upstream fetch failed: ${message}` },
        502,
      );
    }
  });

  archives.get("/:runId/pool", async (c) => {
    const runId = c.req.param("runId");
    const sortRaw = c.req.query("sort");
    const sort: "engagement" | "recency" = sortRaw === "recency" ? "recency" : "engagement";
    const source = c.req.query("source") ?? undefined;
    const q = c.req.query("q") ?? undefined;
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
    try {
      const result = await getPool(runId, { sort, source, q, offset, limit }, {
        archiveRepo: deps.getArchiveRepo(),
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  archives.post("/:runId/promote", async (c) => {
    const runId = c.req.param("runId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = promoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    try {
      const generateRecapFn = deps.generateRecapFn ?? createDefaultGenerateRecapFn();
      const ranked = await promoteItem(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(),
        rawItemsRepo: deps.getRawItemsRepo(),
        generateRecapFn,
      });
      logger.info(
        { event: "archive.promote", runId, rawItemId: parsed.data.rawItemId },
        "archive.promote",
      );
      void captureAnalytics({
        distinctId: "admin",
        event: "item_promoted",
        properties: { run_id: runId, raw_item_id: parsed.data.rawItemId },
      });
      return c.json(ranked);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ConflictError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  archives.delete("/:runId", async (c) => {
    const runId = c.req.param("runId");
    const parsed = z.uuid().safeParse(runId);
    if (!parsed.success) {
      return c.json({ error: "invalid runId" }, 400);
    }
    const result = await deps.getArchiveRepo().delete(runId);
    if (!result.deleted) {
      return c.json({ error: "not found" }, 404);
    }
    if (deps.redis) {
      try {
        await deps.redis.del(`run:${runId}`);
      } catch (err) {
        logger.warn(
          { event: "archive.deleted.redis_cleanup_failed", runId, err: String(err) },
          "redis del failed",
        );
      }
    }
    logger.info(
      { event: "archive.deleted", runId, removedEmailSends: result.removedEmailSends },
      "archive.deleted",
    );
    return c.body(null, 204);
  });

  return archives;
}

function createDefaultGenerateRecapFn(): GenerateRecapFn {
  return async (item, opts) => {
    const { generateRecap } = await import("@newsletter/pipeline/add-post");
    return generateRecap(item, opts);
  };
}

function createDefaultGenerateDigestFn(): GenerateDigestFn {
  return generateReviewDigest;
}

/**
 * Backward-compat: returns a single Hono app with BOTH public and admin archive
 * routes mounted. Kept for existing tests/callers that don't split the gate.
 * New callers in `index.ts` should prefer `createPublicArchivesRouter` +
 * `createAdminArchivesRouter` so the admin gate can be mounted on the admin
 * half only.
 */
export function createArchivesRouter(deps: ArchivesRouterDeps): Hono {
  const app = new Hono();
  app.route("/", createPublicArchivesRouter(deps));
  app.route("/", createAdminArchivesRouter(deps));
  return app;
}

export function createDefaultArchivesRouter(): Hono {
  return createArchivesRouter(createDefaultArchivesDeps());
}

export function createDefaultPublicArchivesRouter(): Hono {
  return createPublicArchivesRouter(createDefaultArchivesDeps());
}

export function createDefaultAdminArchivesRouter(): Hono {
  return createAdminArchivesRouter(createDefaultArchivesDeps());
}

let defaultProcessingQueue: Queue | null = null;
function getDefaultProcessingQueue(): Queue {
  defaultProcessingQueue ??= new BullQueue(
    "processing",
    { connection: createRedisConnection() },
  );
  return defaultProcessingQueue;
}

function createDefaultArchivesDeps(): ArchivesRouterDeps {
  return {
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    hydrateAddedPost: createDefaultHydrateAddedPost(),
    generateRecapFn: createDefaultGenerateRecapFn(),
    generateDigestFn: createDefaultGenerateDigestFn(),
    processingQueue: getDefaultProcessingQueue(),
    redis: createRedisConnection(),
  };
}

function createDefaultHydrateAddedPost(): HydrateAddedPostFn {
  return async (url, sourceType, options) => {
    const { hydrateAddedPost } = await import("@newsletter/pipeline/add-post");
    const { createRawItemsRepo: createPipelineRawItemsRepo } = await import(
      "@newsletter/pipeline/add-post"
    );
    return hydrateAddedPost(url, sourceType, {
      rawItemsRepo: createPipelineRawItemsRepo(defaultGetDb()),
      signal: options?.signal,
    });
  };
}
