import { sesEvents } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SesEventInsert, SesEventSelect } from "@newsletter/shared";

export interface SesEventsRepo {
  upsert(insert: SesEventInsert): Promise<SesEventSelect>;
}

export function createSesEventsRepo(
  db: Pick<AppDb, "insert">,
): SesEventsRepo {
  return {
    async upsert(insert: SesEventInsert): Promise<SesEventSelect> {
      const [row] = await db
        .insert(sesEvents)
        .values(insert)
        .onConflictDoUpdate({
          target: [sesEvents.messageId, sesEvents.eventType],
          set: { occurredAt: insert.occurredAt },
        })
        .returning();
      return row;
    },
  };
}
