import { scopedTenantId, sesEvents } from "@newsletter/shared/db";
import type { AppDb, TenantScope } from "@newsletter/shared/db";
import type { SesEventInsert, SesEventSelect } from "@newsletter/shared";

export interface SesEventsRepo {
  upsert(insert: SesEventInsert): Promise<SesEventSelect>;
}

export function createSesEventsRepo(
  db: Pick<AppDb, "insert">,
  ctx?: TenantScope,
): SesEventsRepo {
  return {
    async upsert(insert: SesEventInsert): Promise<SesEventSelect> {
      const [row] = await db
        .insert(sesEvents)
        .values({ ...insert, tenantId: scopedTenantId(ctx) ?? insert.tenantId })
        .onConflictDoUpdate({
          target: [sesEvents.messageId, sesEvents.eventType],
          set: { occurredAt: insert.occurredAt },
        })
        .returning();
      return row;
    },
  };
}
