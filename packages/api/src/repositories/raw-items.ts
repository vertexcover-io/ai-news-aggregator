import { inArray } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";

export interface RawItemRow {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
}

export interface RawItemsRepo {
  findByIds(ids: number[]): Promise<RawItemRow[]>;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "select">,
): RawItemsRepo {
  return {
    async findByIds(ids: number[]): Promise<RawItemRow[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          title: rawItems.title,
          url: rawItems.url,
          author: rawItems.author,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
        })
        .from(rawItems)
        .where(inArray(rawItems.id, ids));
      return rows;
    },
  };
}
