import type { RankedItem, RankedItemRef, RecapContent } from "@newsletter/shared";
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
    const rawRecap = row.metadata.recap;
    let recap: RecapContent | null = null;
    const hasRefRecap =
      ref.title !== undefined ||
      ref.summary !== undefined ||
      ref.bullets !== undefined ||
      ref.bottomLine !== undefined;
    if (hasRefRecap) {
      recap = {
        title: ref.title ?? rawRecap?.title ?? "",
        summary: ref.summary ?? rawRecap?.summary ?? "",
        bullets: ref.bullets ?? rawRecap?.bullets ?? [],
        bottomLine: ref.bottomLine ?? rawRecap?.bottomLine ?? "",
      };
    } else if (rawRecap) {
      recap = rawRecap;
    }
    const displayTitle = ref.title ?? rawRecap?.title ?? row.title;
    hydrated.push({
      id: row.id,
      rawItemId: row.id,
      title: displayTitle,
      url: row.url,
      sourceType: row.sourceType,
      author: row.author,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      engagement: row.engagement,
      score: ref.score,
      rationale: ref.rationale,
      content: row.content ?? null,
      imageUrl: ref.imageUrl !== undefined ? ref.imageUrl : row.imageUrl,
      recap,
    });
  }
  return hydrated;
}
