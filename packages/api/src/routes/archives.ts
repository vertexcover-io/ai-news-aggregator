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
import {
  selectImmediatePublishChannels,
  jobIdFor,
  PUBLISH_CHANNELS,
  type PublishChannel,
} from "@newsletter/shared/scheduling";
import { Queue as BullQueue } from "bullmq";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createRunArchivesRepo,
  type RunArchiveRow,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createReviewEditsRepo,
  type ReviewEditsRepo,
} from "@api/repositories/review-edits.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  archivePatchSchema,
  addPostSchema,
  promoteSchema,
  regenerateDigestMetaSchema,
} from "@api/lib/validate.js";
import {
  patchArchive,
  addPostToArchive,
  getPool,
  promoteItem,
  regenerateDigestMeta,
  NotFoundError,
  ValidationError,
  ConflictError,
  type HydrateAddedPostFn,
  type GenerateRecapFn,
  type GenerateDigestMetaFn,
} from "@api/services/review.js";
import { captureAnalytics } from "@api/lib/posthog.js";

export interface ArchivesRouterDeps {
  getRawItemsRepo: (scope?: TenantScope) => RawItemsRepo;
  getArchiveRepo: (scope?: TenantScope) => RunArchivesRepo;
  getReviewEditsRepo?: (scope?: TenantScope) => ReviewEditsRepo;
  getSettingsRepo?: (scope?: TenantScope) => Pick<UserSettingsRepo, "get">;
  hydrateAddedPost?: HydrateAddedPostFn;
  generateRecapFn?: GenerateRecapFn;
  generateDigestMeta?: GenerateDigestMetaFn;
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
  archive: Pick<RunArchiveRow, "publishedAt" | "startedAt" | "completedAt">,
  timezone: string,
): string {
  return formatDateInTimezone(
    archive.publishedAt ?? archive.startedAt ?? archive.completedAt,
    timezone,
  );
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

      // REQ-011: public route never serializes shortlistedItemIds
      const state = {
        id: runId,
        status: archive.status,
        stage: archive.status === "completed" ? "completed" : "failed",
        topN: archive.topN,
        startedAt: archive.startedAt?.toISOString() ?? archive.completedAt.toISOString(),
        issueDate: getIssueDate(archive, timezone),
        updatedAt: archive.completedAt.toISOString(),
        completedAt: archive.completedAt.toISOString(),
        sources: {} as RunState["sources"],
        rankedItems: archive.rankedItems,
        warnings: [] as string[],
        error: null as string | null,
        sourceTypes: archive.sourceTypes,
        digestHeadline: archive.digestHeadline,
        digestSummary: archive.digestSummary,
        hook: archive.hook,
      };

      if (archive.status === "completed" && Array.isArray(archive.rankedItems)) {
        const hydrated = await hydrateRankedItems(
          deps.getRawItemsRepo(),
          archive.rankedItems,
          archive.completedAt,
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
      const archive = await deps.getArchiveRepo(tenantScopeFromContext(c)).findById(runId);
      if (!archive) return c.json({ error: "not found" }, 404);
      const timezone = await getConfiguredTimezone(deps);

      // REQ-010: admin route includes shortlistedItemIds (admin-only, never public)
      // REQ-003: admin route includes reviewed + publish timestamps (admin-only, never public)
      const state: RunState & {
        sourceTypes: string[] | null;
        digestHeadline: string | null;
        digestSummary: string | null;
        hook: string | null;
        twitterSummary: string | null;
        linkedinPostBody: string | null;
        isDryRun: boolean;
        shortlistedItemIds: number[] | null;
        reviewed: boolean;
        emailSentAt: string | null;
        linkedinPostedAt: string | null;
        twitterPostedAt: string | null;
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
        shortlistedItemIds: archive.shortlistedItemIds ?? null,
        warnings: [],
        error: null,
        sourceTypes: archive.sourceTypes,
        digestHeadline: archive.digestHeadline,
        digestSummary: archive.digestSummary,
        hook: archive.hook,
        twitterSummary: archive.twitterSummary,
        linkedinPostBody: archive.linkedinPostBody,
        isDryRun: archive.isDryRun,
        reviewed: archive.reviewed,
        emailSentAt: archive.emailSentAt?.toISOString() ?? null,
        linkedinPostedAt: archive.linkedinPostedAt?.toISOString() ?? null,
        twitterPostedAt: archive.twitterPostedAt?.toISOString() ?? null,
      };

      const reviewEditsRepo = deps.getReviewEditsRepo?.(tenantScopeFromContext(c));
      const reviewEdits = reviewEditsRepo
        ? await reviewEditsRepo.listForRun(runId)
        : [];

      const adminState = {
        ...state,
        preReviewSnapshot: archive.preReviewSnapshot ?? null,
        reviewEdits,
      };

      if (archive.status === "completed" && Array.isArray(archive.rankedItems)) {
        const hydrated = await hydrateRankedItems(
          deps.getRawItemsRepo(tenantScopeFromContext(c)),
          archive.rankedItems,
          archive.completedAt,
        );
        return c.json({ ...adminState, rankedItems: hydrated });
      }

      return c.json(adminState);
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
    const publish = parsed.data.publish ?? true;
    try {
      const updated = await patchArchive(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
        rawItemsRepo: deps.getRawItemsRepo(tenantScopeFromContext(c)),
        reviewEditsRepo: deps.getReviewEditsRepo?.(tenantScopeFromContext(c)),
      });
      logger.info(
        { event: "archive.patched", runId, count: parsed.data.rankedItems.length, publish },
        "archive.patched",
      );
      void captureAnalytics({
        distinctId: "admin",
        event: "archive_reviewed",
        properties: { run_id: runId, item_count: parsed.data.rankedItems.length },
      });
      if (publish && deps.processingQueue && deps.getSettingsRepo) {
        const settings = await deps.getSettingsRepo(tenantScopeFromContext(c)).get();
        if (settings) {
          const channels = selectImmediatePublishChannels({
            settings,
            completedAt: updated.completedAt,
            now: new Date(),
          });
          const sentAt: Record<PublishChannel, Date | null> = {
            "email-send": updated.emailSentAt,
            "linkedin-post": updated.linkedinPostedAt,
            "twitter-post": updated.twitterPostedAt,
          };
          const enqueued: PublishChannel[] = [];
          for (const channel of channels) {
            if (sentAt[channel] != null) continue;
            await deps.processingQueue.add(channel, { runId }, { jobId: jobIdFor(channel, runId), delay: 0 });
            enqueued.push(channel);
          }
          const pastDue = new Set<PublishChannel>(channels);
          const deferred = PUBLISH_CHANNELS.filter((c) => !pastDue.has(c));
          logger.info(
            {
              event: "archive.immediate_publish_enqueued",
              runId,
              enqueued,
              evaluated: channels,
              deferred,
            },
            "archive: immediate publish channels enqueued after late review",
          );
        }
      }
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
    const archive = await deps.getArchiveRepo(tenantScopeFromContext(c)).findById(runId);
    if (!archive) return c.json({ error: "not found" }, 404);
    if (deps.processingQueue) {
      await deps.processingQueue.add(
        "email-send",
        { runId },
        { jobId: jobIdFor("email-send", runId), delay: 0 },
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
      // Bind the session tenant scope into the hydrate fn so its raw_items
      // write (pipeline repo) stamps the same tenant as the archive.
      const scope = tenantScopeFromContext(c);
      const hydrate = deps.hydrateAddedPost;
      const ranked = await addPostToArchive(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(scope),
        rawItemsRepo: deps.getRawItemsRepo(scope),
        hydrateAddedPost: hydrate
          ? (url, sourceType, options) =>
              hydrate(url, sourceType, { ...options, scope })
          : undefined,
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

  archives.post("/:runId/regenerate-digest-meta", async (c) => {
    const runId = c.req.param("runId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = regenerateDigestMetaSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    if (!deps.generateDigestMeta) {
      return c.json({ error: "generateDigestMeta dependency not configured" }, 502);
    }
    try {
      const meta = await regenerateDigestMeta(runId, parsed.data, {
        archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
        rawItemsRepo: deps.getRawItemsRepo(tenantScopeFromContext(c)),
        generateDigestMeta: deps.generateDigestMeta,
      });
      logger.info(
        { event: "archive.regenerate-digest-meta", runId, count: parsed.data.items.length },
        "archive.regenerate-digest-meta",
      );
      return c.json(meta);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ConflictError) {
        return c.json({ reason: err.message }, 409);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, missingIds: err.missingIds }, 400);
      }
      const message = err instanceof Error ? err.message : "upstream error";
      logger.warn(
        { event: "archive.regenerate-digest-meta.failed", runId, error: message },
        "archive.regenerate-digest-meta.failed",
      );
      return c.json({ error: `digest regeneration failed: ${message}` }, 502);
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
    // Parse repeated ?sources= params as selectedSources (derived identifier filter, distinct from ?source= SourceType filter)
    const selectedSources = c.req.queries("sources") ?? undefined;
    const selectedSourceTypes = c.req.queries("sourceTypes") ?? undefined;
    const shortlistedOnly = c.req.query("shortlisted") === "true";
    try {
      const result = await getPool(
        runId,
        {
          sort,
          source,
          q,
          offset,
          limit,
          selectedSources,
          selectedSourceTypes,
          shortlistedOnly,
        },
        { archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)) },
      );
      return c.json(result);
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  archives.get("/:runId/source-facets", async (c) => {
    const runId = c.req.param("runId");
    const archive = await deps.getArchiveRepo(tenantScopeFromContext(c)).findById(runId);
    if (!archive) return c.json({ error: "not found" }, 404);
    const facets = await deps.getArchiveRepo(tenantScopeFromContext(c)).getSourceFacets(runId);
    return c.json({ facets });
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
        archiveRepo: deps.getArchiveRepo(tenantScopeFromContext(c)),
        rawItemsRepo: deps.getRawItemsRepo(tenantScopeFromContext(c)),
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
    const result = await deps.getArchiveRepo(tenantScopeFromContext(c)).delete(runId);
    // Always attempt Redis cleanup, even when the DB row was absent: a ghost
    // run (Redis run-state present but archive upsert never reached) is
    // exactly the case where Delete must work. `redis.del` returns the number
    // of keys removed, so we can distinguish ghost-cleanup (1) from true 404 (0).
    let redisKeysRemoved = 0;
    if (deps.redis) {
      try {
        redisKeysRemoved = await deps.redis.del(`run:${runId}`);
      } catch (err) {
        logger.warn(
          { event: "archive.deleted.redis_cleanup_failed", runId, err: String(err) },
          "redis del failed",
        );
      }
    }
    if (!result.deleted) {
      if (redisKeysRemoved > 0) {
        logger.info(
          { event: "archive.deleted.ghost_cleanup", runId },
          "archive.deleted.ghost_cleanup",
        );
        return c.body(null, 204);
      }
      return c.json({ error: "not found" }, 404);
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

function createDefaultGenerateDigestMetaFn(): GenerateDigestMetaFn {
  return async (items) => {
    const { generateDigestMeta } = await import("@newsletter/pipeline/add-post");
    return generateDigestMeta(items);
  };
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
    getRawItemsRepo: (scope) => createRawItemsRepo(defaultGetDb(), scope),
    getArchiveRepo: (scope) => createRunArchivesRepo(defaultGetDb(), scope),
    getReviewEditsRepo: (scope) => createReviewEditsRepo(defaultGetDb(), scope),
    getSettingsRepo: (scope) => createUserSettingsRepo(defaultGetDb(), scope),
    hydrateAddedPost: createDefaultHydrateAddedPost(),
    generateRecapFn: createDefaultGenerateRecapFn(),
    generateDigestMeta: createDefaultGenerateDigestMetaFn(),
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
      rawItemsRepo: createPipelineRawItemsRepo(defaultGetDb(), options?.scope),
      signal: options?.signal,
    });
  };
}
