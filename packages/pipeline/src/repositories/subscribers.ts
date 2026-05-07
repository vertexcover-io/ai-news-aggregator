import { eq, inArray, sql } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberSelect } from "@newsletter/shared";

export interface PipelineSubscribersRepo {
  listConfirmed(): Promise<SubscriberSelect[]>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
  countConfirmed(): Promise<number>;
}

export function createPipelineSubscribersRepo(
  db: Pick<AppDb, "select">,
): PipelineSubscribersRepo {
  return {
    async listConfirmed(): Promise<SubscriberSelect[]> {
      return db
        .select()
        .from(subscribers)
        .where(eq(subscribers.status, "confirmed"));
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      return db.select().from(subscribers).where(inArray(subscribers.id, ids));
    },

    async countConfirmed(): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscribers)
        .where(eq(subscribers.status, "confirmed"));
      return rows[0]?.count ?? 0;
    },
  };
}
