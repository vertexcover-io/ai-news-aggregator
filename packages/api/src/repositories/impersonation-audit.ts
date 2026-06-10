import { impersonationAudit } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";

export interface ImpersonationAuditRepo {
  recordStart(actingUserId: string, targetTenantId: string): Promise<void>;
  recordStop(actingUserId: string, targetTenantId: string): Promise<void>;
}

export function createImpersonationAuditRepo(
  db: Pick<AppDb, "insert">,
): ImpersonationAuditRepo {
  async function record(
    actingUserId: string,
    targetTenantId: string,
    action: "start" | "stop",
  ): Promise<void> {
    await db.insert(impersonationAudit).values({ actingUserId, targetTenantId, action });
  }

  return {
    recordStart: (actingUserId, targetTenantId) =>
      record(actingUserId, targetTenantId, "start"),
    recordStop: (actingUserId, targetTenantId) =>
      record(actingUserId, targetTenantId, "stop"),
  };
}
