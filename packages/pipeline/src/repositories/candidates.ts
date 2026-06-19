import { gte, inArray } from "drizzle-orm";
import { rawItems, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, SourceType, TenantScope } from "@newsletter/shared/db";
import type { RawItemMetadata } from "@newsletter/shared";

export interface CandidateRow {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  metadata: RawItemMetadata;
}

export interface CandidatesRepo {
  findSince(since: Date, sourceTypes: SourceType[]): Promise<CandidateRow[]>;
}

export function createCandidatesRepo(
  db: Pick<AppDb, "select">,
  ctx?: TenantScope,
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
          content: rawItems.content,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(
          tenantScoped(
            rawItems.tenantId,
            ctx,
            gte(rawItems.collectedAt, since),
            inArray(rawItems.sourceType, sourceTypes),
          ),
        );
      return rows;
    },
  };
}
