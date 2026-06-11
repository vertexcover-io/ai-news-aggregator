/**
 * Drizzle tenant-scoping helper (P4, REQ-012/013/014). The ONE auditable seam
 * where the `tenant_id = $tenantId` predicate is built — repositories must
 * route every read/write predicate on a tenant-owned table through
 * `tenantScoped(...)` (enforced by `newsletter/enforce-repository-access`).
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { isTenantContext, type TenantScope } from "../types/tenant-context.js";

export type {
  TenantContext,
  TenantScope,
  AllTenantsScope,
  SystemScope,
} from "../types/tenant-context.js";
export {
  isTenantContext,
  withAllTenants,
  systemScope,
  scopedTenantId,
} from "../types/tenant-context.js";

/**
 * Combine the tenant predicate with the query's own conditions:
 *
 *   .where(tenantScoped(table.tenantId, ctx, eq(table.id, id)))
 *
 * - concrete TenantContext → `tenant_id = ctx.tenantId AND ...conditions`
 * - AllTenantsScope (super-admin escape hatch) → only `...conditions`
 * - undefined (legacy single-tenant mode, pre-P5/P9 call sites) → only
 *   `...conditions`
 *
 * Returns `undefined` when there is nothing to filter on (drizzle treats
 * `.where(undefined)` as no WHERE clause).
 */
export function tenantScoped(
  tenantIdColumn: AnyPgColumn,
  scope: TenantScope | undefined,
  ...conditions: (SQL | undefined)[]
): SQL | undefined {
  if (isTenantContext(scope)) {
    return and(eq(tenantIdColumn, scope.tenantId), ...conditions);
  }
  // Legacy / all-tenants mode: keep the original predicate shape untouched
  // (a single condition passes through without an and() wrapper).
  const remaining = conditions.filter((c): c is SQL => c !== undefined);
  if (remaining.length === 0) return undefined;
  if (remaining.length === 1) return remaining[0];
  return and(...remaining);
}
