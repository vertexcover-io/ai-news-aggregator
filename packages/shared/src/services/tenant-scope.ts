import type { UserRole } from "@shared/types/tenant.js";

/**
 * Tenant context carried on every request. Populated by auth middleware
 * (session cookie for admin, Host header for public site).
 *
 * The `tenantId` is the active tenant. Super admins have `role: "super_admin"`
 * and may optionally set `impersonating: true` + the impersonated `tenantId`.
 */
export interface TenantContext {
  /** Active tenant id (not null — unauthenticated public routes set this from Host). */
  tenantId: string;
  /** User id from the session cookie (absent for unauthenticated public routes). */
  userId?: string;
  /** Role of the authenticated user (absent for unauthenticated routes). */
  role: UserRole;
  /** True when a super admin is impersonating a tenant. */
  impersonating?: boolean;
}

/**
 * Wrapper around TenantContext that signals: "no tenant scoping needed" —
 * the query may read across all tenants (super-admin only).
 *
 * Usage:
 *   const scoped = withAllTenants(ctx);
 *   // ... pass scoped to repositories
 */
export interface AllTenantsScope {
  readonly ctx: TenantContext;
  readonly allTenants: true;
}

/**
 * Wrapper around TenantContext for a normal scoped query.
 */
export interface TenantScope {
  readonly ctx: TenantContext;
  readonly allTenants: false;
}

export type ScopedTenantContext = TenantScope | AllTenantsScope;

/**
 * Create a standard tenant-scoped context from the tenant context.
 * All tenant-owned queries from this will include `where(eq(table.tenantId, ctx.tenantId))`.
 */
export function tenantScoped(ctx: TenantContext): TenantScope {
  return { ctx, allTenants: false };
}

/**
 * Create an escaped all-tenants scope from the tenant context.
 * Only call this from paths gated by `requireSuperAdmin`.
 */
export function withAllTenants(ctx: TenantContext): AllTenantsScope {
  return { ctx, allTenants: true };
}

/**
 * Returns true when the scope allows reading across all tenants.
 */
export function isAllTenants(scoped: ScopedTenantContext): scoped is AllTenantsScope {
  return scoped.allTenants;
}

/**
 * Bootstrap context — allows all-tenant access. Used during app startup
 * (scheduler reconciliation, PostHog config loading) where there is no
 * request-scoped tenant context. Phase 5 replaces these with per-request
 * tenantCtx from the session/Host middleware.
 */
export const BOOTSTRAP_CONTEXT: AllTenantsScope = {
  ctx: { tenantId: "bootstrap", role: "super_admin" },
  allTenants: true,
};
