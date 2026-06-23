import { eq, inArray, sql } from "drizzle-orm";
import { subscribers, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, TenantScope } from "@newsletter/shared/db";
import type { SubscriberSelect } from "@newsletter/shared";

export interface PipelineSubscribersRepo {
  listConfirmed(): Promise<SubscriberSelect[]>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
  countConfirmed(): Promise<number>;
}

export function createPipelineSubscribersRepo(
  db: Pick<AppDb, "select">,
  ctx?: TenantScope,
): PipelineSubscribersRepo {
  return {
    async listConfirmed(): Promise<SubscriberSelect[]> {
      return db
        .select()
        .from(subscribers)
        .where(tenantScoped(subscribers.tenantId, ctx, eq(subscribers.status, "confirmed")));
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      return db.select().from(subscribers).where(tenantScoped(subscribers.tenantId, ctx, inArray(subscribers.id, ids)));
    },

    async countConfirmed(): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscribers)
        .where(tenantScoped(subscribers.tenantId, ctx, eq(subscribers.status, "confirmed")));
      return rows[0]?.count ?? 0;
    },
  };
}
