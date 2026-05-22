import type { Candidate, SourceType } from "@newsletter/shared";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";

function toCandidate(item: FixtureItem): Candidate {
  return {
    id: item.rawItemId,
    title: item.title,
    url: item.url,
    sourceType: item.sourceType as SourceType,
    author: null,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    engagement: item.engagement ?? { points: 0, commentCount: 0 },
    content: item.content,
    comments: item.comments,
  };
}

export function fixtureToCandidates(fixture: Fixture): Candidate[] {
  const excludedIds = new Set<number>();
  for (const cluster of fixture.dedupClusters) {
    for (const dupId of cluster.duplicateIds) {
      excludedIds.add(dupId);
    }
  }
  return fixture.pool
    .filter((item) => !excludedIds.has(item.rawItemId))
    .map(toCandidate);
}
