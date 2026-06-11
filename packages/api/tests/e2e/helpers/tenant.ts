/**
 * Shared e2e tenant fixture (P4 write-side).
 *
 * tenant_id is NOT NULL with no DB DEFAULT on every tenant-owned table, so
 * pre-tenancy e2e suites must construct repositories with a concrete
 * TenantContext and stamp `tenantId` on raw drizzle seed inserts. All
 * pre-tenancy suites share ONE stable tenant — this reproduces the legacy
 * single-tenant namespace those tests were written against (the suite runs
 * single-forked, so files never interleave).
 */
import { getDb, tenants } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const E2E_TENANT_SLUG = "e2e-shared-tenant";

let cached: TenantContext | undefined;

/** Upserts (by slug) and returns the shared e2e tenant context. */
export async function ensureE2eTenant(): Promise<TenantContext> {
  if (cached) return cached;
  const db = getDb();
  const rows = await db
    .insert(tenants)
    .values({
      slug: E2E_TENANT_SLUG,
      name: "E2E Shared Tenant",
      status: "active",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { updatedAt: new Date() },
    })
    .returning({ id: tenants.id });
  cached = { tenantId: rows[0].id, role: "tenant_admin" };
  return cached;
}
