import type { RankedItem, RankedItemRef, RecapContent } from "@newsletter/shared";
import { ENRICHED_SUMMARY_LAUNCHED_AT } from "@newsletter/shared/constants";
import { pickSummarySource, deriveRawItemIdentifier } from "@newsletter/shared/services";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import { buildItemPreview } from "./item-preview.js";

type RawRow = Awaited<ReturnType<RawItemsRepo["findByIds"]>>[number];

export function buildRecapContent(
  ref: RankedItemRef,
  rawRecap: RecapContent | null | undefined,
): RecapContent | null {
  const hasRefRecap =
    ref.title !== undefined ||
    ref.summary !== undefined ||
    ref.bullets !== undefined ||
    ref.bottomLine !== undefined;
  if (hasRefRecap) {
    return {
      title: ref.title ?? rawRecap?.title ?? "",
      summary: ref.summary ?? rawRecap?.summary ?? "",
      bullets: ref.bullets ?? rawRecap?.bullets ?? [],
      bottomLine: ref.bottomLine ?? rawRecap?.bottomLine ?? "",
    };
  }
  return rawRecap ?? null;
}

export function resolveDisplayTitle(
  ref: RankedItemRef,
  rawRecap: RecapContent | null | undefined,
  rowTitle: string,
): string {
  return ref.title ?? rawRecap?.title ?? rowTitle;
}

export function resolveEnrichedSource(
  row: RawRow,
  isLegacyArchive: boolean,
): { hostname: string; url: string } | null {
  if (isLegacyArchive) return null;
  const source = pickSummarySource(row.content, row.metadata.enrichedLink);
  if (source.kind === "enriched") {
    return { hostname: source.hostname, url: source.url };
  }
  return null;
}

export async function hydrateRankedItems(
  repo: RawItemsRepo,
  refs: RankedItemRef[],
  archiveCompletedAt: Date | null = null,
): Promise<RankedItem[]> {
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.rawItemId);
  const rows = await repo.findByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const isLegacyArchive =
    archiveCompletedAt !== null && archiveCompletedAt < ENRICHED_SUMMARY_LAUNCHED_AT;
  const hydrated: RankedItem[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.rawItemId);
    if (!row) continue;
    const rawRecap = row.metadata.recap;
    const recap = buildRecapContent(ref, rawRecap);
    const displayTitle = resolveDisplayTitle(ref, rawRecap, row.title);
    const enrichedSource = resolveEnrichedSource(row, isLegacyArchive);
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
      enrichedSource,
      sourceIdentifier: deriveRawItemIdentifier({
        sourceType: row.sourceType,
        url: row.url,
        sourceUrl: row.sourceUrl,
        metadata: row.metadata,
      }),
      preview: buildItemPreview(row),
    });
  }
  return hydrated;
}
