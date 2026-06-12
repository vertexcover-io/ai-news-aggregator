import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { runArchives, rawItems } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  NotificationKey,
  NotificationState,
  RankedItemRef,
  RunCostBreakdown,
  RunFunnel,
  RunSourceTelemetry,
  SocialMetadata,
  SourceType,
} from "@newsletter/shared";
import { parseRunCostBreakdown } from "@newsletter/shared";
import type { PreReviewSnapshot } from "@newsletter/shared/review-edits";
import { canonicalizeUrl } from "../processors/dedup.js";

export interface RunArchiveUpsertInput {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
  completedAt: Date;
  startedAt?: Date;
  sourceTypes?: SourceType[];
  reviewed?: boolean;
  digestHeadline?: string | null;
  digestSummary?: string | null;
  hook?: string | null;
  twitterSummary?: string | null;
  linkedinPostBody?: string | null;
  sourceTelemetry?: RunSourceTelemetry | null;
  searchText?: string | null;
  isDryRun?: boolean;
  runFunnel?: RunFunnel | null;
  publishedAt?: Date;
  shortlistedItemIds?: number[] | null;
  preReviewSnapshot?: PreReviewSnapshot;
}

export interface PipelineRunArchiveRow {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
  reviewed: boolean;
  completedAt: Date;
  digestHeadline: string | null;
  digestSummary: string | null;
  hook: string | null;
  twitterSummary: string | null;
  linkedinPostBody: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
  emailSentAt: Date | null;
  linkedinPostedAt: Date | null;
  twitterPostedAt: Date | null;
  notificationState: NotificationState | null;
  isDryRun: boolean;
}

export interface RunArchivesRepo {
  upsert(input: RunArchiveUpsertInput): Promise<void>;
  findById(id: string): Promise<PipelineRunArchiveRow | null>;
  findLatestTerminal(): Promise<PipelineRunArchiveRow | null>;
  markSlackNotified(runId: string, at: Date): Promise<void>;
  markEmailSent(runId: string, at: Date): Promise<void>;
  markNotification(runId: string, key: NotificationKey, at: Date): Promise<void>;
  markLinkedInPosted(runId: string, at: Date, permalink: string | null): Promise<void>;
  markTwitterPosted(
    runId: string,
    at: Date,
    permalink: string | null,
    threadIds?: string[],
  ): Promise<void>;
  recordSocialFailure(
    runId: string,
    platform: "linkedin" | "twitter",
    error: string,
  ): Promise<void>;
  setCostBreakdown(runId: string, breakdown: RunCostBreakdown): Promise<void>;
  getCostBreakdown(runId: string): Promise<RunCostBreakdown | null>;
  getPublishedCanonicalUrls(): Promise<Set<string>>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "insert" | "select" | "update">,
  tenantId: string,
): RunArchivesRepo {
  const selectArchiveRow = {
    id: runArchives.id,
    status: runArchives.status,
    rankedItems: runArchives.rankedItems,
    topN: runArchives.topN,
    reviewed: runArchives.reviewed,
    completedAt: runArchives.completedAt,
    digestHeadline: runArchives.digestHeadline,
    digestSummary: runArchives.digestSummary,
    hook: runArchives.hook,
    twitterSummary: runArchives.twitterSummary,
    linkedinPostBody: runArchives.linkedinPostBody,
    sourceTelemetry: runArchives.sourceTelemetry,
    slackNotifiedAt: runArchives.slackNotifiedAt,
    emailSentAt: runArchives.emailSentAt,
    linkedinPostedAt: runArchives.linkedinPostedAt,
    twitterPostedAt: runArchives.twitterPostedAt,
    notificationState: runArchives.notificationState,
    isDryRun: runArchives.isDryRun,
  } as const;

  return {
    async findById(id: string): Promise<PipelineRunArchiveRow | null> {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select(selectArchiveRow)
        .from(runArchives)
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, id)));
      return rows[0] ?? null;
    },

    async findLatestTerminal(): Promise<PipelineRunArchiveRow | null> {
      const rows = await db
        .select(selectArchiveRow)
        .from(runArchives)
        .where(eq(runArchives.tenantId, tenantId))
        .orderBy(desc(runArchives.completedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async markSlackNotified(runId: string, at: Date): Promise<void> {
      await db
        .update(runArchives)
        .set({ slackNotifiedAt: at })
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
    },
    async markEmailSent(runId: string, at: Date): Promise<void> {
      await db
        .update(runArchives)
        .set({ emailSentAt: at })
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
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
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
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
          .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
        return;
      }
      const patch: SocialMetadata = { linkedinPermalink: permalink };
      await db
        .update(runArchives)
        .set({
          linkedinPostedAt: at,
          socialMetadata: sql`coalesce(${runArchives.socialMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
    },

    async markTwitterPosted(
      runId: string,
      at: Date,
      permalink: string | null,
      threadIds?: string[],
    ): Promise<void> {
      const patch: SocialMetadata = {};
      if (permalink !== null) patch.twitterPermalink = permalink;
      if (threadIds !== undefined && threadIds.length > 0) {
        patch.twitterThreadIds = threadIds;
      }
      if (Object.keys(patch).length === 0) {
        await db
          .update(runArchives)
          .set({ twitterPostedAt: at })
          .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
        return;
      }
      await db
        .update(runArchives)
        .set({
          twitterPostedAt: at,
          socialMetadata: sql`coalesce(${runArchives.socialMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
    },

    async setCostBreakdown(
      runId: string,
      breakdown: RunCostBreakdown,
    ): Promise<void> {
      await db
        .update(runArchives)
        .set({ costBreakdown: breakdown })
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
    },

    async getCostBreakdown(runId: string): Promise<RunCostBreakdown | null> {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(runId)) return null;
      const rows = await db
        .select({ costBreakdown: runArchives.costBreakdown })
        .from(runArchives)
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
      if (rows.length === 0) return null;
      return parseRunCostBreakdown(rows[0].costBreakdown);
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
        .where(and(eq(runArchives.tenantId, tenantId), eq(runArchives.id, runId)));
    },

    async upsert(input: RunArchiveUpsertInput): Promise<void> {
      await db
        .insert(runArchives)
        .values({
          tenantId,
          id: input.id,
          status: input.status,
          rankedItems: input.rankedItems,
          topN: input.topN,
          completedAt: input.completedAt,
          startedAt: input.startedAt ?? null,
          sourceTypes: input.sourceTypes ?? null,
          reviewed: input.reviewed ?? false,
          digestHeadline: input.digestHeadline ?? null,
          digestSummary: input.digestSummary ?? null,
          hook: input.hook ?? null,
          twitterSummary: input.twitterSummary ?? null,
          linkedinPostBody: input.linkedinPostBody ?? null,
          sourceTelemetry: input.sourceTelemetry ?? null,
          searchText: input.searchText ?? null,
          isDryRun: input.isDryRun ?? false,
          runFunnel: input.runFunnel ?? null,
          publishedAt: input.publishedAt ?? null,
          shortlistedItemIds: input.shortlistedItemIds ?? null,
          preReviewSnapshot: input.preReviewSnapshot ?? null,
        })
        .onConflictDoUpdate({
          target: runArchives.id,
          set: {
            status: sql.raw(`excluded.${runArchives.status.name}`),
            rankedItems: sql.raw(`excluded.${runArchives.rankedItems.name}`),
            topN: sql.raw(`excluded.${runArchives.topN.name}`),
            completedAt: sql.raw(`excluded.${runArchives.completedAt.name}`),
            reviewed: sql.raw(`excluded.${runArchives.reviewed.name}`),
            digestHeadline: sql.raw(`excluded.${runArchives.digestHeadline.name}`),
            digestSummary: sql.raw(`excluded.${runArchives.digestSummary.name}`),
            hook: sql.raw(`excluded.${runArchives.hook.name}`),
            twitterSummary: sql.raw(`excluded.${runArchives.twitterSummary.name}`),
            linkedinPostBody: sql.raw(`excluded.${runArchives.linkedinPostBody.name}`),
            sourceTelemetry: sql.raw(`excluded.${runArchives.sourceTelemetry.name}`),
            searchText: sql.raw(`excluded.${runArchives.searchText.name}`),
            isDryRun: sql.raw(`excluded.${runArchives.isDryRun.name}`),
            runFunnel: sql.raw(`excluded.${runArchives.runFunnel.name}`),
            publishedAt: sql.raw(`excluded.${runArchives.publishedAt.name}`),
            shortlistedItemIds: sql.raw(`excluded.${runArchives.shortlistedItemIds.name}`),
            // REQ-008: existing non-null snapshot wins; only write when current is null
            preReviewSnapshot: sql`COALESCE(${runArchives.preReviewSnapshot}, excluded.${sql.raw(runArchives.preReviewSnapshot.name)})`,
          },
        });
    },

    async getPublishedCanonicalUrls(): Promise<Set<string>> {
      // Step 1: load rankedItems from all reviewed, non-dry-run, completed archives
      const archiveRows = await db
        .select({ rankedItems: runArchives.rankedItems })
        .from(runArchives)
        .where(
          and(
            eq(runArchives.tenantId, tenantId),
            sql`${runArchives.reviewed} = true AND ${runArchives.isDryRun} = false AND ${runArchives.status} = 'completed'`,
          ),
        );

      if (archiveRows.length === 0) return new Set<string>();

      // Step 2: collect all rawItemIds from the ranked items
      const rawItemIds: number[] = archiveRows.flatMap((row) =>
        row.rankedItems.map((ref) => ref.rawItemId),
      );

      if (rawItemIds.length === 0) return new Set<string>();

      // Step 3: load URLs for those raw_items
      const urlRows = await db
        .select({ url: rawItems.url })
        .from(rawItems)
        .where(and(eq(rawItems.tenantId, tenantId), inArray(rawItems.id, rawItemIds)));

      // Step 4: canonicalize and return
      return new Set(urlRows.map((row) => canonicalizeUrl(row.url)));
    },
  };
}
