import { eq } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";

export interface RunArchiveRow {
  id: string;
  status: "completed" | "failed";
  rankedItems: RankedItemRef[];
  topN: number;
  profileName: string | null;
  completedAt: Date;
  createdAt: Date;
}

export interface RunArchivesRepo {
  findById(id: string): Promise<RunArchiveRow | null>;
}

export function createRunArchivesRepo(
  db: Pick<AppDb, "select">,
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
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
        })
        .from(runArchives)
        .where(eq(runArchives.id, id));
      return rows[0] ?? null;
    },
  };
}
