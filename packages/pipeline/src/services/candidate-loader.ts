import { and, gte, inArray } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";

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
  db: AppDb,
  since: Date,
  sourceTypes: SourceType[],
) => Promise<Candidate[]>;

export const loadCandidatesSince: LoadCandidatesFn = async (
  db,
  since,
  sourceTypes,
) => {
  if (sourceTypes.length === 0) return [];
  const rows = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      sourceType: rawItems.sourceType,
      author: rawItems.author,
      publishedAt: rawItems.publishedAt,
      engagement: rawItems.engagement,
    })
    .from(rawItems)
    .where(
      and(
        gte(rawItems.collectedAt, since),
        inArray(rawItems.sourceType, sourceTypes),
      ),
    );
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
