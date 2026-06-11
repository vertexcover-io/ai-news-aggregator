/**
 * Tenant-scoping contracts threaded through every repository factory (P4,
 * REQ-012/013/126, NF7). Pure types + tiny pure helpers — NO drizzle here so
 * routes/services can import values from this module without violating
 * `newsletter/enforce-repository-access` (drizzle-flavored scoping lives in
 * `@newsletter/shared/db` → `tenant-scope.ts`).
 */
import type { UserRole } from "./tenant.js";

/** Request/job-scoped tenant identity used to scope all tenant-owned DB access. */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  role: UserRole;
  /** True when a super_admin is impersonating this tenant (P6). */
  impersonating?: boolean;
}

/**
 * Explicit cross-tenant escape hatch (REQ allowlist): only obtainable through
 * {@link withAllTenants}, which gates on `super_admin`. Repositories treat it
 * as "no tenant predicate".
 */
export interface AllTenantsScope {
  readonly allTenants: true;
  readonly role: "super_admin";
}

/**
 * What repository factories accept. `undefined` (param omitted) is the
 * legacy single-tenant compatibility mode: queries stay unscoped and inserts
 * fall back to the DB-level tenant-0 column DEFAULT installed by the
 * AGENTLOOP backfill (P2). P5 (host resolution) and P9 (tenant in job
 * payloads) remove the remaining undefined call sites.
 */
export type TenantScope = TenantContext | AllTenantsScope;

/** Narrows a scope to a concrete single-tenant context. */
export function isTenantContext(
  scope: TenantScope | undefined,
): scope is TenantContext {
  return scope !== undefined && !("allTenants" in scope);
}

/**
 * Cross-tenant read scope for super-admin surfaces ONLY (requireSuperAdmin
 * paths). Throws for any other role so a tenant session can never widen
 * itself.
 */
export function withAllTenants(ctx: { role: UserRole }): AllTenantsScope {
  if (ctx.role !== "super_admin") {
    throw new Error("withAllTenants is restricted to super_admin sessions");
  }
  return { allTenants: true, role: "super_admin" };
}

/**
 * Tenant id to stamp on INSERTs: the scoped tenant, or `undefined` to let the
 * column DEFAULT (tenant-0 bridge) apply in legacy/all-tenants mode.
 */
export function scopedTenantId(
  scope: TenantScope | undefined,
): string | undefined {
  return isTenantContext(scope) ? scope.tenantId : undefined;
}
