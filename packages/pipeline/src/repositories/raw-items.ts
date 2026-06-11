import { and, eq, inArray, sql } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, RawItemInsert, SourceType } from "@newsletter/shared/db";
import type { RawItemMetadata, RecapContent } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface RawItemRow {
  id: number;
  sourceType: SourceType;
  externalId: string;
  title: string;
  url: string;
  sourceUrl: string | null;
  author: string | null;
  content: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  metadata: RawItemMetadata;
}

export interface RawItemsRepo {
  upsertItems(items: RawItemInsert[]): Promise<void>;
  findExistingExternalIds(
    sourceType: SourceType,
    externalIds: string[],
  ): Promise<Set<string>>;
  findBySourceAndExternalId(
    sourceType: SourceType,
    externalId: string,
  ): Promise<RawItemRow | null>;
  findByIds(ids: number[]): Promise<RawItemRow[]>;
  updateRecapData(updates: { id: number; recap: RecapContent }[]): Promise<void>;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "insert" | "select" | "update">,
  ctx: TenantContext,
): RawItemsRepo {
  return {
    async upsertItems(items: RawItemInsert[]): Promise<void> {
      if (items.length === 0) return;
      const now = new Date();
      // Postgres rejects an INSERT ... ON CONFLICT batch where two input rows
      // resolve to the same conflict target (21000: "cannot affect row a
      // second time"). Collapse in-batch duplicates by (sourceType,
      // externalId); last write wins, matching ON CONFLICT DO UPDATE
      // semantics if the duplicates had been issued as separate statements.
      const deduped = Array.from(
        new Map(
          items.map((i) => [`${i.sourceType}::${i.externalId}`, i]),
        ).values(),
      );
      const stamped = deduped.map((item) => ({ ...item, tenantId: ctx.tenantId }));
      await db.insert(rawItems).values(stamped).onConflictDoUpdate({
        target: [rawItems.sourceType, rawItems.externalId],
        set: {
          engagement: sql.raw(`excluded.${rawItems.engagement.name}`),
          metadata: sql.raw(`excluded.${rawItems.metadata.name}`),
          imageUrl: sql.raw(`excluded.${rawItems.imageUrl.name}`),
          runId: sql.raw(`excluded.${rawItems.runId.name}`),
          collectedAt: now,
          updatedAt: now,
        },
      });
    },

    async findExistingExternalIds(
      sourceType: SourceType,
      externalIds: string[],
    ): Promise<Set<string>> {
      if (externalIds.length === 0) return new Set();

      const rows = await db
        .select({ externalId: rawItems.externalId })
        .from(rawItems)
        .where(
          ctx.allTenants
            ? and(
                eq(rawItems.sourceType, sourceType),
                inArray(rawItems.externalId, externalIds),
              )
            : and(
                eq(rawItems.sourceType, sourceType),
                inArray(rawItems.externalId, externalIds),
                eq(rawItems.tenantId, ctx.tenantId),
              ),
        );

      return new Set(rows.map((r) => r.externalId));
    },

    async findBySourceAndExternalId(
      sourceType: SourceType,
      externalId: string,
    ): Promise<RawItemRow | null> {
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          externalId: rawItems.externalId,
          title: rawItems.title,
          url: rawItems.url,
          sourceUrl: rawItems.sourceUrl,
          author: rawItems.author,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(
          ctx.allTenants
            ? and(
                eq(rawItems.sourceType, sourceType),
                eq(rawItems.externalId, externalId),
              )
            : and(
                eq(rawItems.sourceType, sourceType),
                eq(rawItems.externalId, externalId),
                eq(rawItems.tenantId, ctx.tenantId),
              ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findByIds(ids: number[]): Promise<RawItemRow[]> {
      if (ids.length === 0) return [];
      return db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          externalId: rawItems.externalId,
          title: rawItems.title,
          url: rawItems.url,
          sourceUrl: rawItems.sourceUrl,
          author: rawItems.author,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(
          ctx.allTenants
            ? inArray(rawItems.id, ids)
            : and(inArray(rawItems.id, ids), eq(rawItems.tenantId, ctx.tenantId)),
        );
    },

    async updateRecapData(updates: { id: number; recap: RecapContent }[]): Promise<void> {
      if (updates.length === 0) return;
      const now = new Date();
      for (const { id, recap } of updates) {
        await db
          .update(rawItems)
          .set({
            metadata: sql`jsonb_set(coalesce(${rawItems.metadata}, '{}'), '{recap}', ${JSON.stringify(recap)}::jsonb)`,
            updatedAt: now,
          })
          .where(
            ctx.allTenants
              ? eq(rawItems.id, id)
              : and(eq(rawItems.id, id), eq(rawItems.tenantId, ctx.tenantId)),
          );
      }
    },
  };
}
