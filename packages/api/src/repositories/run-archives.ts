import { and, desc, eq, gte, ilike, inArray, lte, notInArray, sql } from "drizzle-orm";
import { emailSends, rawItems, runArchives } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import {
  formatDateInTimezone,
  serializeArchiveSearchText,
  type ArchiveListItem,
  type ArchiveTopItem,
  type NotificationKey,
  type NotificationState,
  type PoolItem,
  type RankedItemRef,
  type RunCostBreakdown,
  type RunFunnel,
  type RunSourceTelemetry,
  type SocialMetadata,
} from "@newsletter/shared";
import { deriveRawItemIdentifierSql } from "./raw-items.js";
import type { RawItemRow, RawItemsRepo } from "./raw-items.js";

const DERIVED_IDENTIFIER_SQL = deriveRawItemIdentifierSql();

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
  publishedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  sourceTypes: SourceType[] | null;
  digestHeadline: string | null;
  digestSummary: string | null;
  hook: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
  emailSentAt: Date | null;
  linkedinPostedAt: Date | null;
  twitterPostedAt: Date | null;
  notificationState: NotificationState | null;
  isDryRun: boolean;
  costBreakdown: RunCostBreakdown | null;
  runFunnel: RunFunnel | null;
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
  timezone?: string;
  limit?: number;
}

export interface SearchReviewedInput {
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  rawItemsRepo: RawItemsRepo;
  timezone?: string;
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
  /**
   * Returns the latest reviewed, non-dry-run archive completed at or after
   * `since`, or null when none exist in that window.
   */
  findLatestReviewedSince(since: Date): Promise<RunArchiveRow | null>;
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
  markEmailSent(runId: string, at: Date): Promise<void>;
  markNotification(
    runId: string,
    key: NotificationKey,
    at: Date,
  ): Promise<void>;
  markLinkedInPosted(runId: string, at: Date, permalink: string | null): Promise<void>;
  markTwitterPosted(runId: string, at: Date, permalink: string | null): Promise<void>;
  recordSocialFailure(
    runId: string,
    platform: "linkedin" | "twitter",
    error: string,
  ): Promise<void>;
  delete(id: string): Promise<{ deleted: boolean; removedEmailSends: number }>;
  getReviewedDigestCountsByDerivedSource(opts: {
    from: Date;
    to: Date;
  }): Promise<Map<string, number>>;
  getRecentSourceTelemetry(opts: {
    from: Date;
    to: Date;
  }): Promise<Map<string, RecentSourceTelemetryEntry>>;
  getSourceFailuresInRange(opts: {
    from: Date;
    to: Date;
  }): Promise<RangeFailureEntry[]>;
  countCompletedRunsInRange(opts: { from: Date; to: Date }): Promise<number>;
}

export interface RecentSourceTelemetryEntry {
  displayName: string;
  status: "completed" | "failed" | "partial";
  itemsFetched: number;
  completedAt: Date;
}

export interface RangeFailureEntry {
  sourceType: SourceType;
  identifier: string;
  displayName: string;
  runsAffected: number;
  lastErrorMessage: string;
  lastFailedAt: Date;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "select" | "update" | "execute" | "delete" | "transaction">,
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
          publishedAt: runArchives.publishedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          hook: runArchives.hook,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
          emailSentAt: runArchives.emailSentAt,
          linkedinPostedAt: runArchives.linkedinPostedAt,
          twitterPostedAt: runArchives.twitterPostedAt,
          notificationState: runArchives.notificationState,
          isDryRun: runArchives.isDryRun,
          costBreakdown: runArchives.costBreakdown,
          runFunnel: runArchives.runFunnel,
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
    async markEmailSent(runId: string, at: Date): Promise<void> {
      await db
        .update(runArchives)
        .set({ emailSentAt: at })
        .where(eq(runArchives.id, runId));
    },
    async markNotification(
      runId: string,
      key: NotificationKey,
      at: Date,
    ): Promise<void> {
      await db
        .update(runArchives)
        .set({
          notificationState: sql`coalesce(${runArchives.notificationState}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${at.toISOString()}::text)`,
        })
        .where(eq(runArchives.id, runId));
    },
    async markLinkedInPosted(
      runId: string,
      at: Date,
      permalink: string | null,
    ): Promise<void> {
      if (permalink === null) {
        await db
          .update(runArchives)
          .set({ linkedinPostedAt: at })
          .where(eq(runArchives.id, runId));
        return;
      }
      const patch: SocialMetadata = { linkedinPermalink: permalink };
      await db
        .update(runArchives)
        .set({
          linkedinPostedAt: at,
          socialMetadata: sql`coalesce(${runArchives.socialMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(eq(runArchives.id, runId));
    },
    async markTwitterPosted(
      runId: string,
      at: Date,
      permalink: string | null,
    ): Promise<void> {
      if (permalink === null) {
        await db
          .update(runArchives)
          .set({ twitterPostedAt: at })
          .where(eq(runArchives.id, runId));
        return;
      }
      const patch: SocialMetadata = { twitterPermalink: permalink };
      await db
        .update(runArchives)
        .set({
          twitterPostedAt: at,
          socialMetadata: sql`coalesce(${runArchives.socialMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(eq(runArchives.id, runId));
    },
    async recordSocialFailure(
      runId: string,
      platform: "linkedin" | "twitter",
      error: string,
    ): Promise<void> {
      const patch: SocialMetadata =
        platform === "linkedin" ? { linkedinError: error } : { twitterError: error };
      await db
        .update(runArchives)
        .set({
          socialMetadata: sql`coalesce(${runArchives.socialMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
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
    async findLatestReviewedSince(since: Date): Promise<RunArchiveRow | null> {
      const rows = await db
        .select({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          publishedAt: runArchives.publishedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          hook: runArchives.hook,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
          emailSentAt: runArchives.emailSentAt,
          linkedinPostedAt: runArchives.linkedinPostedAt,
          twitterPostedAt: runArchives.twitterPostedAt,
          notificationState: runArchives.notificationState,
          isDryRun: runArchives.isDryRun,
          costBreakdown: runArchives.costBreakdown,
          runFunnel: runArchives.runFunnel,
        })
        .from(runArchives)
        .where(
          and(
            eq(runArchives.reviewed, true),
            eq(runArchives.isDryRun, false),
            gte(runArchives.completedAt, since),
          ),
        )
        .orderBy(desc(runArchives.completedAt))
        .limit(1);
      return rows[0] ?? null;
    },
    async listReviewed(deps: ListReviewedDeps): Promise<ArchiveListItem[]> {
      const baseQuery = db
        .select({
          runId: runArchives.id,
          completedAt: runArchives.completedAt,
          publishedAt: runArchives.publishedAt,
          rankedItems: runArchives.rankedItems,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          isDryRun: runArchives.isDryRun,
        })
        .from(runArchives)
        .where(and(eq(runArchives.reviewed, true), eq(runArchives.isDryRun, false)))
        .orderBy(
          sql`coalesce(${runArchives.publishedAt}, ${runArchives.completedAt}) desc`,
        );

      const rows =
        deps.limit !== undefined ? await baseQuery.limit(deps.limit) : await baseQuery;

      return hydrateListItems(rows, deps.rawItemsRepo, deps.timezone);
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
          eq(runArchives.isDryRun, false),
          gte(runArchives.completedAt, fromTs),
          lte(runArchives.completedAt, toTs),
        );
        const rows = await db
          .select({
            runId: runArchives.id,
            completedAt: runArchives.completedAt,
            publishedAt: runArchives.publishedAt,
            rankedItems: runArchives.rankedItems,
            digestHeadline: runArchives.digestHeadline,
            digestSummary: runArchives.digestSummary,
            isDryRun: runArchives.isDryRun,
          })
          .from(runArchives)
          .where(where)
          .orderBy(
            sql`coalesce(${runArchives.publishedAt}, ${runArchives.completedAt}) desc`,
          )
          .limit(cappedLimit);

        const [countRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(runArchives)
          .where(where);

        const archives = await hydrateListItems(rows, input.rawItemsRepo, input.timezone);
        return { archives, total: countRow.count };
      }

      const fromIso = fromTs.toISOString();
      const toIso = toTs.toISOString();
      const tsq = sql`websearch_to_tsquery('english', immutable_unaccent(${q}))`;
      const matchedRows = await db.execute<{
        id: string;
        completed_at: Date | string;
        published_at: Date | string | null;
        ranked_items: RankedItemRef[];
        digest_headline: string | null;
        digest_summary: string | null;
        is_dry_run: boolean;
      }>(sql`
        SELECT id, completed_at, published_at, ranked_items, digest_headline, digest_summary, is_dry_run,
               ts_rank_cd(search_tsv, ${tsq}) AS rank
        FROM run_archives
        WHERE reviewed = true
          AND is_dry_run = false
          AND completed_at BETWEEN ${fromIso}::timestamptz AND ${toIso}::timestamptz
          AND search_tsv @@ ${tsq}
        ORDER BY rank DESC, coalesce(published_at, completed_at) DESC
        LIMIT ${cappedLimit}
      `);

      const totalRow = await db.execute<{ c: number }>(sql`
        SELECT count(*)::int AS c
        FROM run_archives
        WHERE reviewed = true
          AND is_dry_run = false
          AND completed_at BETWEEN ${fromIso}::timestamptz AND ${toIso}::timestamptz
          AND search_tsv @@ ${tsq}
      `);

      const rows = matchedRows.map((r) => ({
        runId: r.id,
        completedAt:
          r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at),
        publishedAt:
          r.published_at === null
            ? null
            : r.published_at instanceof Date
              ? r.published_at
              : new Date(r.published_at),
        rankedItems: Array.isArray(r.ranked_items) ? r.ranked_items : [],
        digestHeadline: r.digest_headline,
        digestSummary: r.digest_summary,
        isDryRun: r.is_dry_run,
      }));

      const archives = await hydrateListItems(rows, input.rawItemsRepo, input.timezone);
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
          publishedAt: runArchives.publishedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          hook: runArchives.hook,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
          emailSentAt: runArchives.emailSentAt,
          linkedinPostedAt: runArchives.linkedinPostedAt,
          twitterPostedAt: runArchives.twitterPostedAt,
          notificationState: runArchives.notificationState,
          isDryRun: runArchives.isDryRun,
          costBreakdown: runArchives.costBreakdown,
          runFunnel: runArchives.runFunnel,
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
          publishedAt: runArchives.publishedAt,
          createdAt: runArchives.createdAt,
          startedAt: runArchives.startedAt,
          sourceTypes: runArchives.sourceTypes,
          digestHeadline: runArchives.digestHeadline,
          digestSummary: runArchives.digestSummary,
          hook: runArchives.hook,
          sourceTelemetry: runArchives.sourceTelemetry,
          slackNotifiedAt: runArchives.slackNotifiedAt,
          emailSentAt: runArchives.emailSentAt,
          linkedinPostedAt: runArchives.linkedinPostedAt,
          twitterPostedAt: runArchives.twitterPostedAt,
          notificationState: runArchives.notificationState,
          isDryRun: runArchives.isDryRun,
          costBreakdown: runArchives.costBreakdown,
          runFunnel: runArchives.runFunnel,
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
    async delete(
      id: string,
    ): Promise<{ deleted: boolean; removedEmailSends: number }> {
      return db.transaction(async (tx) => {
        const removed = await tx
          .delete(emailSends)
          .where(eq(emailSends.runArchiveId, id))
          .returning({ id: emailSends.id });
        const archiveRows = await tx
          .delete(runArchives)
          .where(eq(runArchives.id, id))
          .returning({ id: runArchives.id });
        return {
          deleted: archiveRows.length === 1,
          removedEmailSends: removed.length,
        };
      });
    },
    async getReviewedDigestCountsByDerivedSource(opts: {
      from: Date;
      to: Date;
    }): Promise<Map<string, number>> {
      const rows = await db.execute<{
        source_type: SourceType;
        identifier: string;
        n: string | number;
      }>(sql`
        WITH ranked_refs AS (
          SELECT (item->>'rawItemId')::int AS raw_item_id
          FROM run_archives,
               jsonb_array_elements(ranked_items) AS item
          WHERE reviewed = true
            AND status = 'completed'
            AND completed_at >= ${opts.from.toISOString()}::timestamptz
            AND completed_at <  ${opts.to.toISOString()}::timestamptz
        )
        SELECT
          ri.source_type,
          ${DERIVED_IDENTIFIER_SQL} AS identifier,
          COUNT(DISTINCT ri.id) AS n
        FROM raw_items ri
        JOIN ranked_refs rr ON rr.raw_item_id = ri.id
        GROUP BY ri.source_type, identifier
      `);
      const map = new Map<string, number>();
      for (const r of rows) {
        const count =
          typeof r.n === "number" ? r.n : Number.parseInt(r.n, 10);
        map.set(`${r.source_type} ${r.identifier}`, count);
      }
      return map;
    },
    async getRecentSourceTelemetry(opts: {
      from: Date;
      to: Date;
    }): Promise<Map<string, RecentSourceTelemetryEntry>> {
      const rows = await db
        .select({
          sourceTelemetry: runArchives.sourceTelemetry,
          completedAt: runArchives.completedAt,
        })
        .from(runArchives)
        .where(
          and(
            gte(runArchives.completedAt, opts.from),
            sql`${runArchives.completedAt} < ${opts.to.toISOString()}::timestamptz`,
            eq(runArchives.status, "completed"),
            sql`${runArchives.sourceTelemetry} IS NOT NULL`,
          ),
        )
        .orderBy(desc(runArchives.completedAt));

      const map = new Map<string, RecentSourceTelemetryEntry>();
      for (const row of rows) {
        const telemetry = row.sourceTelemetry;
        if (!telemetry) continue;
        for (const entry of telemetry.sources) {
          const key = `${entry.sourceType} ${entry.identifier}`;
          if (map.has(key)) continue;
          map.set(key, {
            displayName: entry.displayName,
            status: entry.status,
            itemsFetched: entry.itemsFetched,
            completedAt: row.completedAt,
          });
        }
      }
      return map;
    },
    async getSourceFailuresInRange(opts: {
      from: Date;
      to: Date;
    }): Promise<RangeFailureEntry[]> {
      const rows = await db.execute<{
        source_type: SourceType;
        identifier: string;
        display_name: string;
        runs_affected: string | number;
        last_error: string;
        last_failed_at: Date | string;
      }>(sql`
        WITH expanded AS (
          SELECT
            ra.completed_at,
            (entry->>'sourceType')::text AS source_type,
            (entry->>'identifier')::text AS identifier,
            COALESCE((entry->>'displayName')::text, (entry->>'identifier')::text) AS display_name,
            (entry->>'status')::text AS status,
            entry->'errors' AS errors
          FROM run_archives ra,
               jsonb_array_elements(ra.source_telemetry->'sources') AS entry
          WHERE ra.status = 'completed'
            AND ra.completed_at >= ${opts.from.toISOString()}::timestamptz
            AND ra.completed_at <  ${opts.to.toISOString()}::timestamptz
            AND ra.source_telemetry IS NOT NULL
        ),
        filtered AS (
          SELECT
            source_type,
            identifier,
            display_name,
            completed_at,
            COALESCE(
              (SELECT errors->>(jsonb_array_length(errors) - 1) WHERE jsonb_array_length(errors) > 0),
              status
            ) AS error_message
          FROM expanded
          WHERE status IN ('failed', 'partial')
        )
        SELECT
          source_type,
          identifier,
          MAX(display_name) AS display_name,
          COUNT(DISTINCT completed_at) AS runs_affected,
          (ARRAY_AGG(error_message ORDER BY completed_at DESC))[1] AS last_error,
          MAX(completed_at) AS last_failed_at
        FROM filtered
        GROUP BY source_type, identifier
        ORDER BY runs_affected DESC, last_failed_at DESC
      `);
      return rows.map((r) => ({
        sourceType: r.source_type,
        identifier: r.identifier,
        displayName: r.display_name,
        runsAffected:
          typeof r.runs_affected === "number"
            ? r.runs_affected
            : Number.parseInt(r.runs_affected, 10),
        lastErrorMessage: r.last_error,
        lastFailedAt:
          r.last_failed_at instanceof Date
            ? r.last_failed_at
            : new Date(r.last_failed_at),
      }));
    },
    async countCompletedRunsInRange(opts: {
      from: Date;
      to: Date;
    }): Promise<number> {
      const rows = await db.execute<{ n: string | number }>(sql`
        SELECT COUNT(*) AS n
        FROM run_archives
        WHERE status = 'completed'
          AND completed_at >= ${opts.from.toISOString()}::timestamptz
          AND completed_at <  ${opts.to.toISOString()}::timestamptz
      `);
      const r = rows[0];
      return typeof r.n === "number" ? r.n : Number.parseInt(r.n, 10);
    },
  };
}

interface ArchiveListSourceRow {
  runId: string;
  completedAt: Date;
  publishedAt: Date | null;
  rankedItems: RankedItemRef[];
  digestHeadline: string | null;
  digestSummary: string | null;
  isDryRun: boolean;
}

export async function hydrateAsArchiveListItem(
  row: RunArchiveRow,
  rawItemsRepo: RawItemsRepo,
): Promise<ArchiveListItem> {
  const source: ArchiveListSourceRow = {
    runId: row.id,
    completedAt: row.completedAt,
    publishedAt: row.publishedAt,
    rankedItems: row.rankedItems,
    digestHeadline: row.digestHeadline,
    digestSummary: row.digestSummary,
    isDryRun: row.isDryRun,
  };
  const [item] = await hydrateListItems([source], rawItemsRepo);
  return item;
}

async function hydrateListItems(
  rows: ArchiveListSourceRow[],
  rawItemsRepo: RawItemsRepo,
  timezone?: string,
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
  return rows.map((r) => toArchiveListItem(r, byId, timezone));
}

function toArchiveListItem(
  r: ArchiveListSourceRow,
  byId: Map<number, RawItemRow>,
  timezone?: string,
): ArchiveListItem {
  return {
    runId: r.runId,
    runDate: formatDateInTimezone(r.publishedAt ?? r.completedAt, timezone),
    storyCount: Array.isArray(r.rankedItems) ? r.rankedItems.length : 0,
    topItems: buildTopItems(r.rankedItems, byId),
    leadSummary: computeLeadSummary(r.rankedItems, byId),
    digestHeadline: r.digestHeadline,
    digestSummary: r.digestSummary,
    isDryRun: r.isDryRun,
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
    const title = ref.title ?? raw.metadata.recap?.title ?? raw.title;
    top.push({ id: raw.id, title, sourceType: raw.sourceType });
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
