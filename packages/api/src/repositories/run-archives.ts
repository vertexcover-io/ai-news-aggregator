import { desc, eq } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";

export interface RunArchiveRow {
  id: string;
  status: "completed" | "failed";
  rankedItems: RankedItemRef[];
  topN: number;
  profileName: string | null;
  reviewed: boolean;
  completedAt: Date;
  createdAt: Date;
}

export interface RunArchivesRepo {
  findById(id: string): Promise<RunArchiveRow | null>;
  list(limit: number): Promise<RunArchiveRow[]>;
  updateRankedItems(
    id: string,
    items: RankedItemRef[],
  ): Promise<RunArchiveRow>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "select" | "update">,
): RunArchivesRepo {
  return {
    async findById(id: string): Promise<RunArchiveRow | null> {
      const rows = await db
        .select({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          profileName: runArchives.profileName,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
        })
        .from(runArchives)
        .where(eq(runArchives.id, id));
      return rows[0] ?? null;
    },
    async list(limit: number): Promise<RunArchiveRow[]> {
      return db
        .select({
          id: runArchives.id,
          status: runArchives.status,
          rankedItems: runArchives.rankedItems,
          topN: runArchives.topN,
          profileName: runArchives.profileName,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
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
          profileName: runArchives.profileName,
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
        });
      return row;
    },
  };
}
