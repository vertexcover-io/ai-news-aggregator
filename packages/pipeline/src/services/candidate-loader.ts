import type { SourceType } from "@newsletter/shared/db";
import type { CandidatesRepo } from "@pipeline/repositories/candidates.js";

export interface Candidate {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
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
  const rows = await repo.findSince(since, sourceTypes);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    sourceType: r.sourceType,
    author: r.author,
    publishedAt: r.publishedAt,
    engagement: r.engagement,
  }));
};
