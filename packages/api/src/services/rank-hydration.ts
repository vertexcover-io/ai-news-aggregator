import { inArray } from "drizzle-orm";
import { rawItems, type AppDb } from "@newsletter/shared";
import type { RankedItem, RankedItemRef } from "@newsletter/shared";

export async function hydrateRankedItems(
  db: AppDb,
  refs: RankedItemRef[],
): Promise<RankedItem[]> {
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.rawItemId);
  const rows = await db.select().from(rawItems).where(inArray(rawItems.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hydrated: RankedItem[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.rawItemId);
    if (!row) continue;
    hydrated.push({
      id: row.id,
      rawItemId: row.id,
      title: row.title,
      url: row.url,
      sourceType: row.sourceType,
      author: row.author,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      engagement: row.engagement,
      score: ref.score,
      rationale: ref.rationale,
    });
  }
  return hydrated;
}
