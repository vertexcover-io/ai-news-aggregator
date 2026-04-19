import { and, desc, eq, gte, ilike, inArray, notInArray, sql } from "drizzle-orm";
import { rawItems, runArchives } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type {
  ArchiveListItem,
  ArchiveTopItem,
  PoolItem,
  RankedItemRef,
} from "@newsletter/shared";
import type { RawItemRow, RawItemsRepo } from "./raw-items.js";

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

export interface RunArchivesRepo {
  findById(id: string): Promise<RunArchiveRow | null>;
  list(limit: number): Promise<RunArchiveRow[]>;
  listReviewed(deps: ListReviewedDeps): Promise<ArchiveListItem[]>;
  updateRankedItems(
    id: string,
    items: RankedItemRef[],
  ): Promise<RunArchiveRow>;
  findPoolItems(
    archiveId: string,
    opts: FindPoolItemsOpts,
  ): Promise<{ items: PoolItem[]; total: number }>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "select" | "update">,
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
        })
        .from(runArchives)
        .where(eq(runArchives.id, id));
      return rows[0] ?? null;
    },
    async listReviewed(deps: ListReviewedDeps): Promise<ArchiveListItem[]> {
      const rows = await db
        .select({
          runId: runArchives.id,
          completedAt: runArchives.completedAt,
          rankedItems: runArchives.rankedItems,
        })
        .from(runArchives)
        .where(eq(runArchives.reviewed, true))
        .orderBy(desc(runArchives.completedAt));

      if (rows.length === 0) return [];

      // Build deduplicated set of first-3 rawItemIds across all rows
      const idSet = new Set<number>();
      for (const r of rows) {
        for (const ref of r.rankedItems.slice(0, 3)) {
          idSet.add(ref.rawItemId);
        }
      }

      const rawRows = await deps.rawItemsRepo.findByIds([...idSet]);
      const byId = new Map<number, RawItemRow>(rawRows.map((r) => [r.id, r]));

      return rows.map((r) => {
        const topItems = buildTopItems(r.rankedItems, byId);
        const leadSummary = computeLeadSummary(r.rankedItems, byId);
        return {
          runId: r.runId,
          runDate: r.completedAt.toISOString().slice(0, 10),
          storyCount: Array.isArray(r.rankedItems) ? r.rankedItems.length : 0,
          topItems,
          leadSummary,
        };
      });
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
        })
        .from(runArchives)
        .orderBy(desc(runArchives.completedAt))
        .limit(limit);
    },
    async updateRankedItems(
      id: string,
      items: RankedItemRef[],
    ): Promise<RunArchiveRow> {
      const [row] = await db
        .update(runArchives)
        .set({
          rankedItems: items,
          reviewed: true,
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
