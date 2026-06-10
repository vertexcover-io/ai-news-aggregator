import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { AGENTLOOP_TENANT_ID, type TenantContext } from "@shared/tenant/context.js";

export interface TenantScope {
  readonly tenantId: string;
  where(extra?: SQL): SQL;
  stamp<T extends object>(values: T): T & { tenantId: string };
}

// During Phase 1 ctx is optional and defaults to AGENTLOOP (tenant 0) so that
// existing single-tenant call sites keep compiling while the seam is wired.
// Phase 2 tightens ctx to required after the backfill/cutover.
export function tenantScope(col: AnyPgColumn, ctx?: TenantContext): TenantScope {
  const tenantId = ctx?.tenantId ?? AGENTLOOP_TENANT_ID;
  const base = eq(col, tenantId);
  return {
    tenantId,
    where(extra) {
      if (extra === undefined) return base;
      return and(base, extra) ?? base;
    },
    stamp(values) {
      return { ...values, tenantId };
    },
  };
}
