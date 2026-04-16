import { desc, eq } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";

export interface RunArchiveRow {
  id: string;
  status: "completed" | "failed" | "cancelled";
  rankedItems: RankedItemRef[];
  topN: number;
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
          reviewed: runArchives.reviewed,
          completedAt: runArchives.completedAt,
          createdAt: runArchives.createdAt,
        });
      return row;
    },
  };
}
