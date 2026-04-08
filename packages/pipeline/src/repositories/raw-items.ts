import { and, eq, inArray, sql } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, RawItemInsert, SourceType } from "@newsletter/shared/db";

export interface RawItemsRepo {
  upsertItems(items: RawItemInsert[]): Promise<void>;
  findExistingExternalIds(
    sourceType: SourceType,
    externalIds: string[],
  ): Promise<Set<string>>;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "insert" | "select">,
): RawItemsRepo {
  return {
    async upsertItems(items: RawItemInsert[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(rawItems).values(items).onConflictDoUpdate({
        target: [rawItems.sourceType, rawItems.externalId],
        set: {
          engagement: sql.raw(`excluded.${rawItems.engagement.name}`),
          metadata: sql.raw(`excluded.${rawItems.metadata.name}`),
          updatedAt: new Date(),
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
  };
}
