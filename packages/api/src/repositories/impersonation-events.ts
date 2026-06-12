import { desc } from "drizzle-orm";
import { impersonationEvents } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";

/**
 * NOT tenant-scoped by design: this is the cross-tenant impersonation audit
 * trail (REQ-103). Rows reference the acting super admin and the target
 * tenant; only super-admin surfaces may read it.
 */

export type ImpersonationAction = "start" | "stop";

export interface ImpersonationEventRecord {
  id: string;
  superAdminUserId: string;
  tenantId: string;
  action: ImpersonationAction;
  createdAt: Date;
}

export interface ImpersonationEventsRepo {
  record(
    superAdminUserId: string,
    tenantId: string,
    action: ImpersonationAction,
  ): Promise<ImpersonationEventRecord>;
  listRecent(limit?: number): Promise<ImpersonationEventRecord[]>;
}

const DEFAULT_LIMIT = 50;

export function createImpersonationEventsRepo(
  db: Pick<AppDb, "insert" | "select">,
): ImpersonationEventsRepo {
  return {
    async record(
      superAdminUserId: string,
      tenantId: string,
      action: ImpersonationAction,
    ): Promise<ImpersonationEventRecord> {
      const [row] = await db
        .insert(impersonationEvents)
        .values({ superAdminUserId, tenantId, action })
        .returning();
      return row;
    },

    async listRecent(
      limit: number = DEFAULT_LIMIT,
    ): Promise<ImpersonationEventRecord[]> {
      return db
        .select()
        .from(impersonationEvents)
        .orderBy(desc(impersonationEvents.createdAt))
        .limit(limit);
    },
  };
}
