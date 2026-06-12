import { and, asc, between, desc, eq, gte, sql } from "drizzle-orm";
import { rawItems, runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import {
  endOfDateInTimezone,
  startOfDateInTimezone,
} from "@newsletter/shared";
import type {
  CalendarRankingItem,
  CalendarRunDetail,
  CalendarRunSummary,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";
import { dedupCandidates } from "@pipeline/processors/dedup.js";
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
   * inclusive range `[from, to]`. Used as a fallback for pre-migration archives
   * that have no `run_id` on their items.
   */
  findRawItemsInWindow(opts: { from: Date; to: Date }): Promise<RawItemRow[]>;

  /**
   * Returns every `raw_items` row whose `collected_at` falls on the given
   * UTC calendar day (`YYYY-MM-DD`), ordered by `collected_at desc`. Used
   * by Mode B (`/admin/eval` Calendar) to build an in-memory fixture from
   * a single day's collected items without requiring a saved fixture file.
   */
  findRawItemsByDate(dateISO: string): Promise<RawItemRow[]>;

  /**
   * Returns completed newsletter archives for a calendar day in the selected
   * admin timezone (`YYYY-MM-DD`), ordered by completion time descending. This
   * powers calendar eval run selection and fixture-import browsing.
   */
  listCompletedRunsByDate(
    dateISO: string,
    timezone?: string,
  ): Promise<CalendarRunSummary[]>;

  /**
   * Returns a completed archive's previous ranking plus the reconstructed
   * source pool from raw_items collected during the run window.
   */
  getCompletedRunDetail(runId: string): Promise<CalendarRunDetail | null>;
}

export interface CompletedRunsDateWindow {
  readonly from: Date;
  readonly to: Date;
}

export function completedRunsDateWindow(
  dateISO: string,
  timezone: string | null | undefined,
): CompletedRunsDateWindow | null {
  const from = startOfDateInTimezone(dateISO, timezone);
  const to = endOfDateInTimezone(dateISO, timezone);
  if (from === null || to === null) return null;
  return { from, to };
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function buildFixtureItem(row: RawItemRow): FixtureItem {
  const enrichedLink = row.metadata.enrichedLink ?? null;
  const enrichmentStatus = enrichedLink?.status ?? "skipped";
  return {
    rawItemId: row.id,
    title: row.title,
    url: row.url,
    sourceType: row.sourceType,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    content: row.content,
    enrichedLink,
    enrichmentStatus,
    comments: row.metadata.comments,
    engagement: row.engagement,
  };
}

function buildPreviousRanking(
  archive: EvalExportArchiveRow,
  sourcePool: readonly FixtureItem[],
): CalendarRankingItem[] {
  const sourceById = new Map(sourcePool.map((item) => [item.rawItemId, item]));
  return archive.rankedItems.map((item, index) => {
    const source = sourceById.get(item.rawItemId);
    return {
      rank: index + 1,
      rawItemId: item.rawItemId,
      title: item.title ?? source?.title ?? `#${String(item.rawItemId)}`,
      url: source?.url ?? "",
      sourceType: source?.sourceType ?? "",
      score: item.score,
      rationale: item.rationale,
      summary: item.summary ?? "",
      bullets: item.bullets ?? [],
      bottomLine: item.bottomLine ?? "",
    };
  });
}

const RAW_ITEMS_SELECT = {
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
} as const;

/**
 * Loads raw_items by run_id. Falls back to the time-window query when no items
 * are tagged with the run_id (pre-migration archives). Then deduplicates the
 * resulting FixtureItems using dedupCandidates, coalescing null engagement to
 * {points:0, commentCount:0} for the dedup input.
 */
async function loadDedupedPool(
  db: Pick<AppDb, "select">,
  tenantId: string,
  archive: EvalExportArchiveRow,
): Promise<FixtureItem[]> {
  const byRunId = await db
    .select(RAW_ITEMS_SELECT)
    .from(rawItems)
    .where(and(eq(rawItems.tenantId, tenantId), eq(rawItems.runId, archive.id)));

  const rows: RawItemRow[] =
    byRunId.length > 0
      ? byRunId
      : await db
          .select(RAW_ITEMS_SELECT)
          .from(rawItems)
          .where(
            and(
              eq(rawItems.tenantId, tenantId),
              between(
                rawItems.collectedAt,
                archive.startedAt ?? archive.createdAt,
                archive.completedAt,
              ),
            ),
          );

  const fixtureItems = rows.map(buildFixtureItem);

  const dedupInput = fixtureItems.map((f) => ({
    id: f.rawItemId,
    url: f.url,
    engagement: f.engagement ?? { points: 0, commentCount: 0 },
  }));
  const survivors = dedupCandidates(dedupInput);
  const survivingIds = new Set(survivors.map((s) => s.id));
  return fixtureItems.filter((f) => survivingIds.has(f.rawItemId));
}

export function createEvalExportsRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
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
            and(
              eq(runArchives.tenantId, tenantId),
              eq(runArchives.status, "completed"),
              eq(runArchives.id, runId),
            ),
          );
        return rows;
      }

      const rows = await db
        .select(selectRow)
        .from(runArchives)
        .where(
          and(
            eq(runArchives.tenantId, tenantId),
            eq(runArchives.status, "completed"),
            gte(runArchives.createdAt, since),
          ),
        )
        .orderBy(asc(runArchives.createdAt));
      return rows;
    },

    async findRawItemsByDate(dateISO) {
      const rows = await db
        .select(RAW_ITEMS_SELECT)
        .from(rawItems)
        .where(
          and(
            eq(rawItems.tenantId, tenantId),
            sql`date_trunc('day', ${rawItems.collectedAt}) = ${dateISO}::date`,
          ),
        )
        .orderBy(desc(rawItems.collectedAt));
      return rows;
    },

    async findRawItemsInWindow({ from, to }) {
      return db
        .select(RAW_ITEMS_SELECT)
        .from(rawItems)
        .where(
          and(
            eq(rawItems.tenantId, tenantId),
            between(rawItems.collectedAt, from, to),
          ),
        );
    },

    async listCompletedRunsByDate(dateISO, timezone = "UTC") {
      const window = completedRunsDateWindow(dateISO, timezone);
      if (window === null) return [];
      const rows = await db
        .select({
          id: runArchives.id,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          sourceTypes: runArchives.sourceTypes,
        })
        .from(runArchives)
        .where(
          and(
            eq(runArchives.tenantId, tenantId),
            eq(runArchives.status, "completed"),
            between(runArchives.completedAt, window.from, window.to),
          ),
        )
        .orderBy(desc(runArchives.completedAt));

      // Load deduped pool per run so itemCount == detail.itemCount (REQ-009)
      const summaries = await Promise.all(
        rows.map(async (row) => {
          const archive: EvalExportArchiveRow = {
            id: row.id,
            rankedItems: row.rankedItems,
            createdAt: row.createdAt,
            completedAt: row.completedAt,
            startedAt: row.startedAt,
          };
          const pool = await loadDedupedPool(db, tenantId, archive);
          return {
            runId: row.id,
            completedAt: row.completedAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
            startedAt: toIso(row.startedAt),
            itemCount: pool.length,
            topN: row.topN,
            digestHeadline: row.digestHeadline,
            digestSummary: row.digestSummary,
            sourceTypes: row.sourceTypes ?? [],
          };
        }),
      );
      return summaries;
    },

    async getCompletedRunDetail(runId) {
      const rows = await db
        .select({
          id: runArchives.id,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          sourceTypes: runArchives.sourceTypes,
        })
        .from(runArchives)
        .where(
          and(
            eq(runArchives.tenantId, tenantId),
            eq(runArchives.status, "completed"),
            eq(runArchives.id, runId),
          ),
        );
      if (rows.length === 0) return null;
      const row = rows[0];
      const archive: EvalExportArchiveRow = {
        id: row.id,
        rankedItems: row.rankedItems,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        startedAt: row.startedAt,
      };
      // sourcePool is the deduped collected pool attributed by run_id (REQ-004/005/006)
      const sourcePool = await loadDedupedPool(db, tenantId, archive);
      return {
        runId: row.id,
        completedAt: row.completedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        startedAt: toIso(row.startedAt),
        itemCount: sourcePool.length,
        topN: row.topN,
        digestHeadline: row.digestHeadline,
        digestSummary: row.digestSummary,
        sourceTypes: row.sourceTypes ?? [],
        previousRanking: buildPreviousRanking(archive, sourcePool),
        sourcePool,
      };
    },
  };
}
