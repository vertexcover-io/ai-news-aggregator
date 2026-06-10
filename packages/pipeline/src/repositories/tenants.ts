import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantSelect } from "@newsletter/shared/db";
import type { DomainVerificationStatus } from "@newsletter/shared/types";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";

export interface PipelineTenantsRepo {
  /** Get a tenant's domain status. Returns null if no domain is configured. */
  getDomainStatus(tenantId: string): Promise<{
    status: DomainVerificationStatus;
    domainName: string | null;
  } | null>;
}

export function createPipelineTenantsRepo(
  db: Pick<AppDb, "select">,
  scoped: ScopedTenantContext,
): PipelineTenantsRepo {
  const allTenants = isAllTenants(scoped);
  return {
    async getDomainStatus(tenantId: string): Promise<{
      status: DomainVerificationStatus;
      domainName: string | null;
    } | null> {
      if (!allTenants && scoped.tenantId !== tenantId) return null;
      const rows = await db
        .select({
          domainId: tenants.domainId,
          domainName: tenants.domainName,
          domainStatus: tenants.domainStatus,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const row = rows[0];
      if (!row?.domainId) return null;
      return {
        status: (row.domainStatus as DomainVerificationStatus) ?? "none",
        domainName: row.domainName ?? null,
      };
    },
  };
}
