import { desc, eq, sql } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  NotificationKey,
  NotificationState,
  RankedItemRef,
  RunCostBreakdown,
  RunSourceTelemetry,
  SocialMetadata,
  SourceType,
} from "@newsletter/shared";

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
  sourceTelemetry?: RunSourceTelemetry | null;
  searchText?: string | null;
  isDryRun?: boolean;
  costBreakdown?: RunCostBreakdown | null;
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
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "insert" | "select" | "update">,
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
        .where(eq(runArchives.id, id));
      return rows[0] ?? null;
    },

    async findLatestTerminal(): Promise<PipelineRunArchiveRow | null> {
      const rows = await db
        .select(selectArchiveRow)
        .from(runArchives)
        .orderBy(desc(runArchives.completedAt))
        .limit(1);
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
          notificationState: sql`coalesce(${runArchives.notificationState}, '{}'::jsonb) || jsonb_build_object(${key}, ${at.toISOString()})`,
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
          .where(eq(runArchives.id, runId));
        return;
      }
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

    async upsert(input: RunArchiveUpsertInput): Promise<void> {
      await db
        .insert(runArchives)
        .values({
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
          sourceTelemetry: input.sourceTelemetry ?? null,
          searchText: input.searchText ?? null,
          isDryRun: input.isDryRun ?? false,
          costBreakdown: input.costBreakdown ?? null,
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
            sourceTelemetry: sql.raw(`excluded.${runArchives.sourceTelemetry.name}`),
            searchText: sql.raw(`excluded.${runArchives.searchText.name}`),
            isDryRun: sql.raw(`excluded.${runArchives.isDryRun.name}`),
            costBreakdown: sql.raw(`excluded.${runArchives.costBreakdown.name}`),
          },
        });
    },
  };
}
