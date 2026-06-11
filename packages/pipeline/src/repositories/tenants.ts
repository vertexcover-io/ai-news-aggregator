/**
 * Pipeline-side tenant reads (P14, REQ-053): the email-send worker consults
 * the JOB tenant's sending-domain status to gate the subscriber broadcast.
 */
import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { isTenantContext, type TenantScope } from "@newsletter/shared/types/tenant-context";
import type { SendingDomainStatus } from "@newsletter/shared/types/tenant";

export interface PipelineTenantsRepo {
  /**
   * Sending-domain status of the scoped tenant; `null` when the tenant never
   * registered a domain (the broadcast gate treats that as not verified,
   * EDGE-006) or when the scope carries no concrete tenant.
   */
  getSendingDomainStatus(): Promise<SendingDomainStatus | null>;
}

export function createPipelineTenantsRepo(
  db: Pick<AppDb, "select">,
  ctx?: TenantScope,
): PipelineTenantsRepo {
  return {
    async getSendingDomainStatus(): Promise<SendingDomainStatus | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({ status: tenants.sendingDomainStatus })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      return rows[0]?.status ?? null;
    },
  };
}
