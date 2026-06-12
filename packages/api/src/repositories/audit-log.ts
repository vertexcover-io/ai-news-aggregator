/**
 * Platform audit trail (P6, REQ-103): impersonation start/stop records.
 *
 * audit_log is NOT a tenant-owned table — it is written and read exclusively
 * by super-admin/platform flows (requireSuperAdmin-gated), so it takes no
 * TenantScope. `tenantId` here is the audit SUBJECT (which tenant was
 * impersonated), not a row-ownership fence.
 */
import { auditLog } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { AuditAction } from "@newsletter/shared/types/tenant";

export interface AuditLogEntry {
  action: AuditAction;
  /** The super admin performing the action (preserved identity). */
  actorUserId: string;
  /** The tenant the action targeted. */
  tenantId: string;
}

export interface AuditLogRepo {
  record(entry: AuditLogEntry): Promise<void>;
}

export function createAuditLogRepo(db: Pick<AppDb, "insert">): AuditLogRepo {
  return {
    async record(entry: AuditLogEntry): Promise<void> {
      await db.insert(auditLog).values({
        action: entry.action,
        actorUserId: entry.actorUserId,
        tenantId: entry.tenantId,
      });
    },
  };
}
