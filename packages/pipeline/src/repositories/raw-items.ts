import { and, eq, inArray, sql } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, RawItemInsert, SourceType } from "@newsletter/shared/db";
import type { RecapContent } from "@newsletter/shared";

export interface RawItemsRepo {
  upsertItems(items: RawItemInsert[]): Promise<void>;
  findExistingExternalIds(
    sourceType: SourceType,
    externalIds: string[],
  ): Promise<Set<string>>;
  updateRecapData(updates: { id: number; recap: RecapContent }[]): Promise<void>;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "insert" | "select" | "update">,
): RawItemsRepo {
  return {
    async upsertItems(items: RawItemInsert[]): Promise<void> {
      if (items.length === 0) return;
      const now = new Date();
      await db.insert(rawItems).values(items).onConflictDoUpdate({
        target: [rawItems.sourceType, rawItems.externalId],
        set: {
          engagement: sql.raw(`excluded.${rawItems.engagement.name}`),
          metadata: sql.raw(`excluded.${rawItems.metadata.name}`),
          imageUrl: sql.raw(`excluded.${rawItems.imageUrl.name}`),
          collectedAt: now,
          updatedAt: now,
        },
      });
    },

    async findExistingExternalIds(
      sourceType: SourceType,
      externalIds: string[],
    ): Promise<Set<string>> {
      if (externalIds.length === 0) return new Set();

      const rows = await db
        .select({ externalId: rawItems.externalId })
        .from(rawItems)
        .where(
          and(
            eq(rawItems.sourceType, sourceType),
            inArray(rawItems.externalId, externalIds),
          ),
        );

      return new Set(rows.map((r) => r.externalId));
    },

    async updateRecapData(updates: { id: number; recap: RecapContent }[]): Promise<void> {
      if (updates.length === 0) return;
      const now = new Date();
      for (const { id, recap } of updates) {
        await db
          .update(rawItems)
          .set({
            metadata: sql`jsonb_set(coalesce(${rawItems.metadata}, '{}'), '{recap}', ${JSON.stringify(recap)}::jsonb)`,
            updatedAt: now,
          })
          .where(eq(rawItems.id, id));
      }
    },
  };
}
