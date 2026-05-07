import { eq, sql } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  RankedItemRef,
  RunSourceTelemetry,
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
  sourceTelemetry?: RunSourceTelemetry | null;
}

export interface PipelineRunArchiveRow {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
  reviewed: boolean;
  completedAt: Date;
  digestHeadline: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
}

export interface RunArchivesRepo {
  upsert(input: RunArchiveUpsertInput): Promise<void>;
  findById(id: string): Promise<PipelineRunArchiveRow | null>;
  markSlackNotified(runId: string, at: Date): Promise<void>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "insert" | "select" | "update">,
): RunArchivesRepo {
  return {
    async findById(id: string): Promise<PipelineRunArchiveRow | null> {
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
          digestHeadline: runArchives.digestHeadline,
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
          sourceTelemetry: input.sourceTelemetry ?? null,
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
            sourceTelemetry: sql.raw(`excluded.${runArchives.sourceTelemetry.name}`),
          },
        });
    },
  };
}
