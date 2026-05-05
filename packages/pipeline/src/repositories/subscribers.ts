import { eq, inArray } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberSelect } from "@newsletter/shared";

export interface PipelineSubscribersRepo {
  listConfirmed(): Promise<SubscriberSelect[]>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
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
  };
}
