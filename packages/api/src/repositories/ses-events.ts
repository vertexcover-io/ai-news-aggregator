import { sesEvents, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SesEventInsert, SesEventSelect, TenantContext } from "@newsletter/shared";

export interface SesEventsRepo {
  upsert(insert: Omit<SesEventInsert, "tenantId">): Promise<SesEventSelect>;
}

export function createSesEventsRepo(
  db: Pick<AppDb, "insert">,
  ctx?: TenantContext,
): SesEventsRepo {
  const scope = tenantScope(sesEvents.tenantId, ctx);
  return {
    async upsert(insert: Omit<SesEventInsert, "tenantId">): Promise<SesEventSelect> {
      const [row] = await db
        .insert(sesEvents)
        .values(scope.stamp(insert))
        .onConflictDoUpdate({
          target: [sesEvents.messageId, sesEvents.eventType],
          set: { occurredAt: insert.occurredAt },
        })
        .returning();
      return row;
    },
  };
}
