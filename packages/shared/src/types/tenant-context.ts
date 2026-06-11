import type { UserRole } from "./tenant.js";

export type { UserRole } from "./tenant.js";

export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly role: UserRole;
  readonly impersonating?: boolean;
  /** When true, repos skip tenant_id filtering (super-admin cross-tenant reads).
   *  Set ONLY via withAllTenants(). The lint rule recognizes that function name. */
  readonly allTenants?: boolean;
}

/** Nil UUID used ONLY for pipeline initialization where no real tenant context exists.
 *  NEVER use a bare string like "bootstrap" — it causes UUID constraint violations. */
export const BOOTSTRAP_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/** Escape hatch for super-admin cross-tenant reads.
 *  The lint rule recognizes this function name.
 *  Security gate: ONLY call from `requireSuperAdmin` paths. */
export function withAllTenants(ctx: TenantContext): TenantContext {
  return { ...ctx, allTenants: true };
}
