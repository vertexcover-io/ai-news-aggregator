import { Hono } from "hono";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { RunState } from "@newsletter/shared";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";

export interface ArchivesRouterDeps {
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createArchivesRouter(deps: ArchivesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:archives");
  const archives = new Hono();

  archives.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    try {
      const archive = await deps.getArchiveRepo().findById(runId);
      if (!archive) return c.json({ error: "not found" }, 404);

      const state: RunState = {
        id: runId,
        status: archive.status,
        stage: archive.status === "completed" ? "completed" : "failed",
        topN: archive.topN,
        startedAt: archive.completedAt.toISOString(),
        updatedAt: archive.completedAt.toISOString(),
        completedAt: archive.completedAt.toISOString(),
        sources: {},
        rankedItems: archive.rankedItems,
        warnings: [],
        error: null,
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

export function createDefaultArchivesRouter(): Hono {
  return createArchivesRouter({
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
  });
}
