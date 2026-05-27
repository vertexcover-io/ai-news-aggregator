import type { EnrichedLinkContent } from "../types/index.js";
import type {
  ItemDedupStatus,
  ItemEnrichStatus,
  ItemFurthestStage,
  ItemLifecycle,
  RunSourceItem,
  RunSourceItemsSummary,
} from "../types/observability.js";

export interface ClassifyItemLifecycleInput {
  readonly id: number;
  readonly title: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly engagement: { readonly points: number; readonly commentCount: number };
  readonly publishedAt: string | null;
  readonly sourceIdentifier: string;
  readonly enrichedLink: EnrichedLinkContent | undefined;
  readonly dedup: {
    readonly status: ItemDedupStatus;
    readonly winnerTitle: string | null;
    readonly winnerId: number | null;
    readonly winnerPoints: number | null;
  } | null;
  readonly shortlistedIds: readonly number[] | null;
  readonly rankByItemId: ReadonlyMap<number, number>;
  readonly live: boolean;
}

function enrichStatus(enrichedLink: EnrichedLinkContent | undefined): ItemEnrichStatus {
  return enrichedLink?.status ?? "none";
}

function enrichReason(enrichedLink: EnrichedLinkContent | undefined): string | null {
  if (enrichedLink?.status === "failed") {
    return enrichedLink.failureReason ?? null;
  }
  if (enrichedLink?.status === "skipped") {
    return enrichedLink.skipReason ?? null;
  }
  return null;
}

function classifyFurthestStage(lifecycle: ItemLifecycle): ItemFurthestStage {
  if (lifecycle.rank !== null) return "ranked";
  if (lifecycle.shortlisted === true) return "shortlisted";
  if (lifecycle.dedup?.status === "dropped") return "dedup-dropped";
  if (lifecycle.enrich.status === "failed") return "enrich-failed";
  if (lifecycle.dedup?.status === "survived") return "deduped-survivor";
  return "fetched";
}

function dedupDropReason(lifecycle: ItemLifecycle, itemPoints: number): string {
  const winnerTitle = lifecycle.dedup?.winnerTitle;
  if (!winnerTitle) return "dedup-dropped · duplicate URL";

  const winnerPoints = lifecycle.dedup?.winnerPoints;
  const pointsClause =
    winnerPoints === null
      ? ""
      : ` (${String(winnerPoints)} vs ${String(itemPoints)} pts)`;
  return `dedup-dropped · duplicate URL, lost to "${winnerTitle}"${pointsClause}`;
}

function enrichDropReason(lifecycle: ItemLifecycle): string | null {
  if (lifecycle.shortlisted !== false) return null;
  if (lifecycle.enrich.status === "failed") {
    const reason = lifecycle.enrich.reason ?? "unknown";
    return `enrich-failed: ${reason} · not shortlisted (title-only signal)`;
  }
  if (lifecycle.enrich.status === "skipped") {
    const reason = lifecycle.enrich.reason ?? "unknown";
    return `enrich-skipped: ${reason} · not shortlisted`;
  }
  return null;
}

function dropReason(
  furthestStage: ItemFurthestStage,
  lifecycle: ItemLifecycle,
  itemPoints: number,
): string | null {
  if (furthestStage === "dedup-dropped") return dedupDropReason(lifecycle, itemPoints);
  if (furthestStage === "enrich-failed" || lifecycle.enrich.status === "skipped") {
    return enrichDropReason(lifecycle);
  }
  return null;
}

export function classifyItemLifecycle(input: ClassifyItemLifecycleInput): RunSourceItem {
  const rank = input.rankByItemId.get(input.id) ?? null;
  const shortlisted =
    input.shortlistedIds === null ? null : input.shortlistedIds.includes(input.id);
  const lifecycle: ItemLifecycle = {
    fetched: true,
    enrich: {
      status: enrichStatus(input.enrichedLink),
      reason: enrichReason(input.enrichedLink),
    },
    dedup: input.dedup,
    shortlisted,
    rank,
  };
  const furthestStage = classifyFurthestStage(lifecycle);

  return {
    id: input.id,
    title: input.title,
    url: input.url,
    author: input.author,
    engagement: input.engagement,
    publishedAt: input.publishedAt,
    sourceIdentifier: input.sourceIdentifier,
    lifecycle,
    furthestStage,
    dropReason: dropReason(furthestStage, lifecycle, input.engagement.points),
  };
}

function stagePriority(stage: ItemFurthestStage): number {
  switch (stage) {
    case "ranked":
      return 0;
    case "shortlisted":
      return 1;
    case "deduped-survivor":
      return 2;
    case "dedup-dropped":
      return 3;
    case "enrich-failed":
      return 4;
    case "fetched":
      return 5;
  }
}

export function orderSourceItems(items: readonly RunSourceItem[]): RunSourceItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDiff =
        stagePriority(left.item.furthestStage) - stagePriority(right.item.furthestStage);
      if (rankDiff !== 0) return rankDiff;

      if (left.item.furthestStage === "ranked" && right.item.furthestStage === "ranked") {
        const leftRank = left.item.lifecycle.rank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.item.lifecycle.rank ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

export function summarizeSourceItems(
  items: readonly RunSourceItem[],
): RunSourceItemsSummary {
  const empty: RunSourceItemsSummary = {
    ranked: 0,
    shortlisted: 0,
    dedupedSurvivors: 0,
    dedupDropped: 0,
    enrichFailed: 0,
  };
  return items.reduce(
    (summary, item) => ({
      ranked: summary.ranked + (item.furthestStage === "ranked" ? 1 : 0),
      shortlisted: summary.shortlisted + (item.furthestStage === "shortlisted" ? 1 : 0),
      dedupedSurvivors:
        summary.dedupedSurvivors + (item.furthestStage === "deduped-survivor" ? 1 : 0),
      dedupDropped:
        summary.dedupDropped + (item.furthestStage === "dedup-dropped" ? 1 : 0),
      enrichFailed:
        summary.enrichFailed + (item.furthestStage === "enrich-failed" ? 1 : 0),
    }),
    empty,
  );
}
