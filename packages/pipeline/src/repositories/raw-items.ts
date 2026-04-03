import { sql } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";

export async function upsertItems(db: Pick<AppDb, "insert">, items: RawItemInsert[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(rawItems).values(items).onConflictDoUpdate({
    target: [rawItems.sourceType, rawItems.externalId],
    set: {
      engagement: sql.raw(`excluded.${rawItems.engagement.name}`),
      metadata: sql.raw(`excluded.${rawItems.metadata.name}`),
      updatedAt: new Date(),
    },
  });
}
