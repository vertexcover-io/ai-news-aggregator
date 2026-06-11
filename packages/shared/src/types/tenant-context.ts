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
 * Trusted server-side cross-tenant scope for flows that have NO user session
 * at all, e.g. the SNS webhook: it is an unauthenticated external endpoint
 * gated by AWS SNS signature verification, and a bounce/complaint for one
 * email may legitimately match subscribers across multiple tenants. Unlike
 * {@link AllTenantsScope} it is not derived from (or gated on) a user role —
 * obtain it via {@link systemScope} ONLY in server bootstrap wiring for
 * trusted system flows, never from request/session data.
 */
export interface SystemScope {
  readonly allTenants: true;
  readonly role: "system";
}

/**
 * What repository factories accept. `undefined` (param omitted) is the
 * legacy single-tenant compatibility mode: queries stay unscoped and inserts
 * fall back to the DB-level tenant-0 column DEFAULT installed by the
 * AGENTLOOP backfill (P2). P5 (host resolution) and P9 (tenant in job
 * payloads) remove the remaining undefined call sites.
 */
export type TenantScope = TenantContext | AllTenantsScope | SystemScope;

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
 * System cross-tenant scope for trusted server-side flows with no user
 * session (see {@link SystemScope}). Deliberately NOT gated on a role —
 * the safety boundary is the call site: only server bootstrap code may call
 * this, for endpoints whose trust is established by other means (the SNS
 * webhook only reaches repository code after AWS SNS signature
 * verification in `webhooks.ts`). Repositories treat it exactly like
 * AllTenantsScope: no tenant predicate.
 */
export function systemScope(): SystemScope {
  return { allTenants: true, role: "system" };
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
