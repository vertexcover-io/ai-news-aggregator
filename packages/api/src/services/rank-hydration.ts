import type { RankedItem, RankedItemRef } from "@newsletter/shared";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";

export async function hydrateRankedItems(
  repo: RawItemsRepo,
  refs: RankedItemRef[],
): Promise<RankedItem[]> {
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.rawItemId);
  const rows = await repo.findByIds(ids);
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
