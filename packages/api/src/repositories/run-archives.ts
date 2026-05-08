import { and, desc, eq, gte, ilike, inArray, lte, notInArray, sql } from "drizzle-orm";
import { rawItems, runArchives } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import {
  serializeArchiveSearchText,
  type ArchiveListItem,
  type ArchiveTopItem,
  type PoolItem,
  type RankedItemRef,
  type RunSourceTelemetry,
} from "@newsletter/shared";
import type { RawItemRow, RawItemsRepo } from "./raw-items.js";

export interface UpdateRankedItemsContext {
  rawItemsById: Map<number, RawItemRow>;
  digestHeadline: string | null;
  digestSummary: string | null;
}

export interface RunArchiveRow {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
  reviewed: boolean;
  completedAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  sourceTypes: SourceType[] | null;
  digestHeadline: string | null;
  digestSummary: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
}

export interface FindPoolItemsOpts {
  rankedIds: number[];
  startedAt: Date;
  sourceTypes: SourceType[];
  sort: "engagement" | "recency";
  source?: SourceType;
  q?: string;
  offset: number;
  limit: number;
}

export interface ListReviewedDeps {
  rawItemsRepo: RawItemsRepo;
}

export interface SearchReviewedInput {
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  rawItemsRepo: RawItemsRepo;
}

export interface SearchReviewedResult {
  archives: ArchiveListItem[];
  total: number;
}

export interface RunArchivesRepo {
  findById(id: string): Promise<RunArchiveRow | null>;
  list(limit: number): Promise<RunArchiveRow[]>;
  listReviewed(deps: ListReviewedDeps): Promise<ArchiveListItem[]>;
  searchReviewed(input: SearchReviewedInput): Promise<SearchReviewedResult>;
  /**
   * Returns the most recently completed reviewed archive, regardless of date.
   * Used by the confirm flow to send a freshly-confirmed subscriber the latest
   * digest they missed — even if it was published before today.
   */
  findMostRecentReviewed(): Promise<{ id: string } | null>;
  updateRankedItems(
    id: string,
    items: RankedItemRef[],
    ctx: UpdateRankedItemsContext,
  ): Promise<RunArchiveRow>;
  findPoolItems(
    archiveId: string,
    opts: FindPoolItemsOpts,
  ): Promise<{ items: PoolItem[]; total: number }>;
  markSlackNotified(runId: string, at: Date): Promise<void>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "select" | "update" | "execute">,
): RunArchivesRepo {
  function toPoolItem(row: {
    id: number;
    title: string;
    url: string;
    sourceType: SourceType;
    author: string | null;
    publishedAt: Date | null;
    engagement: { points: number; commentCount: number };
    imageUrl: string | null;
  }): PoolItem {
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      sourceType: row.sourceType,
      author: row.author,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      engagement: row.engagement,
      imageUrl: row.imageUrl,
    };
  }
  return {
    async findById(id: string): Promise<RunArchiveRow | null> {
      // Postgres throws "invalid input syntax for type uuid" when id is not a
      // valid UUID — treat that as not-found rather than a 500.
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
        })
        .from(runArchives)
        .where(eq(runArchives.id, id));
      return rows[0] ?? null;
    },
    async markSlackNotified(runId: string, at: Date): Promise<void> {
      await db
        .update(runArchives)
        .set({ slackNotifiedAt: at })
        .where(eq(runArchives.id, runId));
    },
    async findMostRecentReviewed(): Promise<{ id: string } | null> {
      const rows = await db
        .select({ id: runArchives.id })
        .from(runArchives)
        .where(eq(runArchives.reviewed, true))
        .orderBy(desc(runArchives.completedAt))
        .limit(1);
      if (rows.length === 0) return null;
      return { id: rows[0].id };
    },
    async listReviewed(deps: ListReviewedDeps): Promise<ArchiveListItem[]> {
      const rows = await db
        .select({
          runId: runArchives.id,
          completedAt: runArchives.completedAt,
          rankedItems: runArchives.rankedItems,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
        })
        .from(runArchives)
        .where(eq(runArchives.reviewed, true))
        .orderBy(desc(runArchives.completedAt));

      return hydrateListItems(rows, deps.rawItemsRepo);
    },
    async searchReviewed(
      input: SearchReviewedInput,
    ): Promise<SearchReviewedResult> {
      const cappedLimit = Math.min(Math.max(input.limit ?? 50, 1), 50);
      const fromTs = input.from ?? new Date(0);
      const toTs = input.to ?? new Date("9999-12-31T23:59:59.999Z");
      const q = input.q?.trim();

      if (!q) {
        const where = and(
          eq(runArchives.reviewed, true),
          gte(runArchives.completedAt, fromTs),
          lte(runArchives.completedAt, toTs),
        );
        const rows = await db
          .select({
            runId: runArchives.id,
            completedAt: runArchives.completedAt,
            rankedItems: runArchives.rankedItems,
            digestHeadline: runArchives.digestHeadline,
            digestSummary: runArchives.digestSummary,
          })
          .from(runArchives)
          .where(where)
          .orderBy(desc(runArchives.completedAt))
          .limit(cappedLimit);

        const [countRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(runArchives)
          .where(where);

        const archives = await hydrateListItems(rows, input.rawItemsRepo);
        return { archives, total: countRow.count };
      }

      const fromIso = fromTs.toISOString();
      const toIso = toTs.toISOString();
      const tsq = sql`websearch_to_tsquery('english', immutable_unaccent(${q}))`;
      const matchedRows = await db.execute<{
        id: string;
        completed_at: Date | string;
        ranked_items: RankedItemRef[];
        digest_headline: string | null;
        digest_summary: string | null;
      }>(sql`
        SELECT id, completed_at, ranked_items, digest_headline, digest_summary,
               ts_rank_cd(search_tsv, ${tsq}) AS rank
        FROM run_archives
        WHERE reviewed = true
          AND completed_at BETWEEN ${fromIso}::timestamptz AND ${toIso}::timestamptz
          AND search_tsv @@ ${tsq}
        ORDER BY rank DESC, completed_at DESC
        LIMIT ${cappedLimit}
      `);

      const totalRow = await db.execute<{ c: number }>(sql`
        SELECT count(*)::int AS c
        FROM run_archives
        WHERE reviewed = true
          AND completed_at BETWEEN ${fromIso}::timestamptz AND ${toIso}::timestamptz
          AND search_tsv @@ ${tsq}
      `);

      const rows = matchedRows.map((r) => ({
        runId: r.id,
        completedAt:
          r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at),
        rankedItems: Array.isArray(r.ranked_items) ? r.ranked_items : [],
        digestHeadline: r.digest_headline,
        digestSummary: r.digest_summary,
      }));

      const archives = await hydrateListItems(rows, input.rawItemsRepo);
      return { archives, total: totalRow[0].c };
    },
    async list(limit: number): Promise<RunArchiveRow[]> {
      return db
        .select({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
        })
        .from(runArchives)
        .orderBy(desc(runArchives.completedAt))
        .limit(limit);
    },
    async updateRankedItems(
      id: string,
      items: RankedItemRef[],
      ctx: UpdateRankedItemsContext,
    ): Promise<RunArchiveRow> {
      const searchText = serializeArchiveSearchText({
        digestHeadline: ctx.digestHeadline,
        digestSummary: ctx.digestSummary,
        rankedItems: items,
        rawItemsById: ctx.rawItemsById,
      });
      const [row] = await db
        .update(runArchives)
        .set({
          rankedItems: items,
          reviewed: true,
          searchText,
          updatedAt: new Date(),
        })
        .where(eq(runArchives.id, id))
        .returning({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
        });
      return row;
    },
    async findPoolItems(
      _archiveId: string,
      opts: FindPoolItemsOpts,
    ): Promise<{ items: PoolItem[]; total: number }> {
      const conditions = [
        gte(rawItems.collectedAt, opts.startedAt),
        inArray(rawItems.sourceType, opts.sourceTypes),
      ];
      if (opts.rankedIds.length > 0) {
        conditions.push(notInArray(rawItems.id, opts.rankedIds));
      }
      if (opts.source) {
        conditions.push(eq(rawItems.sourceType, opts.source));
      }
      if (opts.q) {
        const escaped = opts.q.replace(/[%_\\]/g, "\\$&");
        conditions.push(ilike(rawItems.title, `%${escaped}%`));
      }
      const where = and(...conditions);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(rawItems)
        .where(where);

      const orderBy =
        opts.sort === "recency"
          ? [sql`${rawItems.publishedAt} DESC NULLS LAST`]
          : [sql`(${rawItems.engagement}->>'points')::int DESC NULLS LAST`];

      const rows = await db
        .select({
          id: rawItems.id,
          title: rawItems.title,
          url: rawItems.url,
          sourceType: rawItems.sourceType,
          author: rawItems.author,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          imageUrl: rawItems.imageUrl,
        })
        .from(rawItems)
        .where(where)
        .orderBy(...orderBy)
        .limit(opts.limit)
        .offset(opts.offset);

      return { items: rows.map(toPoolItem), total: countRow.count };
    },
  };
}

interface ArchiveListSourceRow {
  runId: string;
  completedAt: Date;
  rankedItems: RankedItemRef[];
  digestHeadline: string | null;
  digestSummary: string | null;
}

async function hydrateListItems(
  rows: ArchiveListSourceRow[],
  rawItemsRepo: RawItemsRepo,
): Promise<ArchiveListItem[]> {
  if (rows.length === 0) return [];
  const idSet = new Set<number>();
  for (const r of rows) {
    for (const ref of r.rankedItems.slice(0, 3)) {
      idSet.add(ref.rawItemId);
    }
  }
  const rawRows = await rawItemsRepo.findByIds([...idSet]);
  const byId = new Map<number, RawItemRow>(rawRows.map((r) => [r.id, r]));
  return rows.map((r) => toArchiveListItem(r, byId));
}

function toArchiveListItem(
  r: ArchiveListSourceRow,
  byId: Map<number, RawItemRow>,
): ArchiveListItem {
  return {
    runId: r.runId,
    runDate: r.completedAt.toISOString().slice(0, 10),
    storyCount: Array.isArray(r.rankedItems) ? r.rankedItems.length : 0,
    topItems: buildTopItems(r.rankedItems, byId),
    leadSummary: computeLeadSummary(r.rankedItems, byId),
    digestHeadline: r.digestHeadline,
    digestSummary: r.digestSummary,
  };
}

function buildTopItems(
  rankedItems: RankedItemRef[],
  byId: Map<number, RawItemRow>,
): ArchiveTopItem[] {
  const top: ArchiveTopItem[] = [];
  for (const ref of rankedItems.slice(0, 3)) {
    const raw = byId.get(ref.rawItemId);
    if (!raw) continue;
    top.push({ id: raw.id, title: raw.title, sourceType: raw.sourceType });
  }
  return top;
}

function computeLeadSummary(
  rankedItems: RankedItemRef[],
  byId: Map<number, RawItemRow>,
): string | null {
  if (rankedItems.length === 0) return null;
  const firstRef = rankedItems[0];
  // Override takes precedence — even empty string (EDGE-005)
  if (firstRef.summary !== undefined) return firstRef.summary;
  const firstRaw = byId.get(firstRef.rawItemId);
  const summary = firstRaw?.metadata.recap?.summary;
  if (summary) return summary;
  return null;
}
