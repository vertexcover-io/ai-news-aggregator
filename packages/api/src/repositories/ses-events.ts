import { sesEvents } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SesEventInsert, SesEventSelect } from "@newsletter/shared";

export interface SesEventsRepo {
  upsert(insert: Omit<SesEventInsert, "tenantId">): Promise<SesEventSelect>;
}

export function createSesEventsRepo(
  db: Pick<AppDb, "insert">,
  tenantId: string,
): SesEventsRepo {
  return {
    async upsert(insert: Omit<SesEventInsert, "tenantId">): Promise<SesEventSelect> {
      const [row] = await db
        .insert(sesEvents)
        .values({ ...insert, tenantId })
        .onConflictDoUpdate({
          target: [sesEvents.messageId, sesEvents.eventType],
          set: { occurredAt: insert.occurredAt },
        })
        .returning();
      return row;
    },
  };
}
