import { and, eq, inArray, sql } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberSelect } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface PipelineSubscribersRepo {
  listConfirmed(): Promise<SubscriberSelect[]>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
  countConfirmed(): Promise<number>;
}

export function createPipelineSubscribersRepo(
  db: Pick<AppDb, "select">,
  ctx: TenantContext,
): PipelineSubscribersRepo {
  return {
    async listConfirmed(): Promise<SubscriberSelect[]> {
      return db
        .select()
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.status, "confirmed")
            : and(eq(subscribers.status, "confirmed"), eq(subscribers.tenantId, ctx.tenantId)),
        );
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      return db.select().from(subscribers).where(
        ctx.allTenants
          ? inArray(subscribers.id, ids)
          : and(inArray(subscribers.id, ids), eq(subscribers.tenantId, ctx.tenantId)),
      );
    },

    async countConfirmed(): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.status, "confirmed")
            : and(eq(subscribers.status, "confirmed"), eq(subscribers.tenantId, ctx.tenantId)),
        );
      return rows[0]?.count ?? 0;
    },
  };
}
