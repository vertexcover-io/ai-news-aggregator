import type { SourceType } from "@newsletter/shared/db";
import type { CandidatesRepo } from "@pipeline/repositories/candidates.js";
import type {
  Candidate,
  EnrichedLinkContent,
  RawItemMetadata,
} from "@newsletter/shared";
import { pickSummarySource } from "@newsletter/shared/services";

export type { Candidate };

/**
 * Pick the best available body text for a candidate.
 *
 * Priority (delegated to pickSummarySource):
 *   1. `metadata.enrichedLink.markdown` (status=ok, non-empty) — enriched
 *      content wins because it is richer than raw tweet/post text.
 *   2. `raw_items.content` — populated by web/web-search collectors at scrape
 *      time; null for native HN/Reddit/Twitter items.
 *   3. null — the rank-body-loader will fall back to a live fetch.
 *
 * Single source of truth, called from both the production candidate loader
 * and the eval fixture replay so they never disagree on what the LLM sees.
 */
export function pickCandidateContent(
  content: string | null,
  metadata: RawItemMetadata | null | undefined,
  enrichedLink?: EnrichedLinkContent | null,
): string | null {
  const enriched = enrichedLink ?? metadata?.enrichedLink ?? null;
  const source = pickSummarySource(content, enriched);
  if (source.kind === "enriched") return source.markdown;
  if (source.kind === "native") return source.content;
  return null;
}

export type LoadCandidatesFn = (
  repo: CandidatesRepo,
  since: Date,
  sourceTypes: SourceType[],
) => Promise<Candidate[]>;

export const loadCandidatesSince: LoadCandidatesFn = async (
  repo,
  since,
  sourceTypes,
) => {
  if (sourceTypes.length === 0) return [];
  const rows = await repo.findSince(since, sourceTypes);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    sourceType: r.sourceType,
    author: r.author,
    publishedAt: r.publishedAt,
    engagement: r.engagement,
    content: pickCandidateContent(r.content, r.metadata),
    comments: r.metadata.comments,
  }));
};
