import { Hono } from "hono";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { ArchiveListResponse, RunState } from "@newsletter/shared";
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
} from "@api/services/review.js";

export interface ArchivesRouterDeps {
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  hydrateAddedPost?: HydrateAddedPostFn;
  generateRecapFn?: GenerateRecapFn;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicArchivesRouter(deps: ArchivesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:archives");
  const archives = new Hono();

  archives.get("/", async (c) => {
    const items = await deps.getArchiveRepo().listReviewed({
      rawItemsRepo: deps.getRawItemsRepo(),
    });
    return c.json({ archives: items } satisfies ArchiveListResponse);
  });

  archives.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    try {
      const archive = await deps.getArchiveRepo().findById(runId);
      if (!archive) return c.json({ error: "not found" }, 404);

      const state: RunState & { sourceTypes: string[] | null } = {
        id: runId,
        status: archive.status,
        stage: archive.status === "completed" ? "completed" : "failed",
        topN: archive.topN,
        startedAt: archive.startedAt?.toISOString() ?? archive.completedAt.toISOString(),
        updatedAt: archive.completedAt.toISOString(),
        completedAt: archive.completedAt.toISOString(),
        sources: {},
        rankedItems: archive.rankedItems,
        warnings: [],
        error: null,
        sourceTypes: archive.sourceTypes,
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
      });
      logger.info(
        { event: "archive.patched", runId, count: parsed.data.rankedItems.length },
        "archive.patched",
      );
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

  return archives;
}

function createDefaultGenerateRecapFn(): GenerateRecapFn {
  return async (item, opts) => {
    const { generateRecap } = await import("@newsletter/pipeline/add-post");
    return generateRecap(item, opts);
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

export function createDefaultArchivesRouter(): Hono {
  return createArchivesRouter(createDefaultArchivesDeps());
}

export function createDefaultPublicArchivesRouter(): Hono {
  return createPublicArchivesRouter(createDefaultArchivesDeps());
}

export function createDefaultAdminArchivesRouter(): Hono {
  return createAdminArchivesRouter(createDefaultArchivesDeps());
}

function createDefaultArchivesDeps(): ArchivesRouterDeps {
  return {
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    hydrateAddedPost: createDefaultHydrateAddedPost(),
    generateRecapFn: createDefaultGenerateRecapFn(),
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
