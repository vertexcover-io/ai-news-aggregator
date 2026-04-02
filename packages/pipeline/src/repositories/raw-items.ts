import { rawItems } from "@newsletter/shared/db";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";

export interface RawItemsRepo {
  upsertItems(items: RawItemInsert[]): Promise<void>;
}

export function createRawItemsRepo(db: Pick<AppDb, "insert">): RawItemsRepo {
  return {
    async upsertItems(items: RawItemInsert[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(rawItems).values(items).onConflictDoUpdate({
        target: [rawItems.sourceType, rawItems.externalId],
        set: {
          engagement: items[0].engagement,
          metadata: items[0].metadata,
          updatedAt: new Date(),
        },
      });
    },
  };
}
