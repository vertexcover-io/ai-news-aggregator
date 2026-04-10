import type { SourceType } from "@newsletter/shared/db";
import type { CandidatesRepo } from "@pipeline/repositories/candidates.js";
import type { Candidate } from "@newsletter/shared";

export type { Candidate };

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
    content: r.content,
    comments: r.metadata.comments,
  }));
};
