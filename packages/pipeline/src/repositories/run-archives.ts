import { sql } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef, SourceType } from "@newsletter/shared";

export interface RunArchiveUpsertInput {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
  completedAt: Date;
  startedAt?: Date;
  sourceTypes?: SourceType[];
  reviewed?: boolean;
}

export interface RunArchivesRepo {
  upsert(input: RunArchiveUpsertInput): Promise<void>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "insert">,
): RunArchivesRepo {
  return {
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
        })
        .onConflictDoUpdate({
          target: runArchives.id,
          set: {
            status: sql.raw(`excluded.${runArchives.status.name}`),
            rankedItems: sql.raw(`excluded.${runArchives.rankedItems.name}`),
            topN: sql.raw(`excluded.${runArchives.topN.name}`),
            completedAt: sql.raw(`excluded.${runArchives.completedAt.name}`),
            reviewed: sql.raw(`excluded.${runArchives.reviewed.name}`),
          },
        });
    },
  };
}
