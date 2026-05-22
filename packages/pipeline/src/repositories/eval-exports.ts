import { and, asc, between, eq, gte } from "drizzle-orm";
import { rawItems, runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RawItemRow } from "./raw-items.js";

/**
 * Subset of a run_archives row needed for exporting a fixture.
 */
export interface EvalExportArchiveRow {
  id: string;
  rankedItems: import("@newsletter/shared").RankedItemRef[];
  createdAt: Date;
  completedAt: Date;
  startedAt: Date | null;
}

export interface EvalExportsRepo {
  /**
   * Returns all completed archives whose `created_at` is at-or-after `since`,
   * ordered ascending by `created_at`. When `runId` is provided, the result is
   * restricted to that single archive (and `since` is ignored).
   */
  listCompletedArchives(opts: {
    since: Date;
    runId?: string;
  }): Promise<EvalExportArchiveRow[]>;

  /**
   * Returns every `raw_items` row whose `collected_at` falls inside the
   * inclusive range `[from, to]`. `raw_items` has no `run_id` column, so the
   * pre-rank pool for a run is approximated by the items collected within the
   * run's lifetime; callers should pass `startedAt` (or `createdAt` as a
   * fallback) for `from` and `completedAt` for `to`.
   */
  findRawItemsInWindow(opts: { from: Date; to: Date }): Promise<RawItemRow[]>;
}

export function createEvalExportsRepo(
  db: Pick<AppDb, "select">,
): EvalExportsRepo {
  return {
    async listCompletedArchives({ since, runId }) {
      const selectRow = {
        id: runArchives.id,
        rankedItems: runArchives.rankedItems,
        createdAt: runArchives.createdAt,
        completedAt: runArchives.completedAt,
        startedAt: runArchives.startedAt,
      } as const;

      if (runId !== undefined) {
        const rows = await db
          .select(selectRow)
          .from(runArchives)
          .where(
            and(eq(runArchives.status, "completed"), eq(runArchives.id, runId)),
          );
        return rows;
      }

      const rows = await db
        .select(selectRow)
        .from(runArchives)
        .where(
          and(
            eq(runArchives.status, "completed"),
            gte(runArchives.createdAt, since),
          ),
        )
        .orderBy(asc(runArchives.createdAt));
      return rows;
    },

    async findRawItemsInWindow({ from, to }) {
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          externalId: rawItems.externalId,
          title: rawItems.title,
          url: rawItems.url,
          sourceUrl: rawItems.sourceUrl,
          author: rawItems.author,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(between(rawItems.collectedAt, from, to));
      return rows;
    },
  };
}
