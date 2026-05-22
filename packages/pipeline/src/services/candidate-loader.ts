import type { SourceType } from "@newsletter/shared/db";
import type { CandidatesRepo } from "@pipeline/repositories/candidates.js";
import type {
  Candidate,
  EnrichedLinkContent,
  RawItemMetadata,
} from "@newsletter/shared";

export type { Candidate };

/**
 * Pick the best available body text for a candidate.
 *
 * Priority:
 *   1. `raw_items.content` — populated by web/web-search collectors at scrape
 *      time; null for native HN/Reddit/Twitter items.
 *   2. `metadata.enrichedLink.markdown` — populated by the link-enrichment
 *      service for every item whose external URL was successfully fetched.
 *      Reusing it here avoids a second live fetch in the ranker.
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
  if (content !== null && content.length > 0) return content;
  const enriched = enrichedLink ?? metadata?.enrichedLink ?? null;
  if (enriched?.status === "ok" && enriched.markdown && enriched.markdown.length > 0) {
    return enriched.markdown;
  }
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
