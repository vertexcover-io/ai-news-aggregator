import type { TenantContext } from "@newsletter/shared/tenant";

export interface TenantVariables {
  tenantCtx?: TenantContext;
  tenantSlug?: string;
}
