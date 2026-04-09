import { and, gte, inArray } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";

export interface CandidateRow {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
}

export interface CandidatesRepo {
  findSince(since: Date, sourceTypes: SourceType[]): Promise<CandidateRow[]>;
}

export function createCandidatesRepo(
  db: Pick<AppDb, "select">,
): CandidatesRepo {
  return {
    async findSince(
      since: Date,
      sourceTypes: SourceType[],
    ): Promise<CandidateRow[]> {
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
      return rows;
    },
  };
}
