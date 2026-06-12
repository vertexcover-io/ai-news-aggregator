import type { UserRole } from "../db/schema.js";

/** Per-request auth context derived from the verified session cookie.
 * `tenantId` is the effective tenant (impersonated tenant when a super_admin
 * is impersonating, otherwise the user's own tenant). It is null only for a
 * non-impersonating super_admin. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  tenantId: string | null;
  realTenantId: string | null;
  impersonating: boolean;
}

/** Per-request tenant context resolved from the request Host on public
 * routes. `slug` is null when the tenant was resolved via the hardcoded
 * tenant-0 custom-domain mapping rather than a subdomain. */
export interface PublicTenantContext {
  tenantId: string;
  slug: string | null;
}
