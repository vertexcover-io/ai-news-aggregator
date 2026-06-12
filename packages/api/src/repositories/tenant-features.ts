import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";

/**
 * Small accessor for the per-tenant feature toggles stored on the tenants
 * row (REQ-093). Kept separate from tenants.ts so the feature-toggle surface
 * (settings PUT) does not depend on the tenant-resolution repository.
 * NOT tenant-scoped: tenants IS the tenant table; callers pass the id.
 */

export interface TenantFeatureFlags {
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
}

export interface TenantFeaturesRepo {
  get(tenantId: string): Promise<TenantFeatureFlags | null>;
  /** Partial update: omitted flags stay untouched. Returns null for an unknown tenant. */
  update(
    tenantId: string,
    patch: Partial<TenantFeatureFlags>,
  ): Promise<TenantFeatureFlags | null>;
}

const FLAG_COLUMNS = {
  canonEnabled: tenants.canonEnabled,
  deliverabilityEnabled: tenants.deliverabilityEnabled,
  evalEnabled: tenants.evalEnabled,
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTenantFeaturesRepo(
  db: Pick<AppDb, "select" | "update">,
): TenantFeaturesRepo {
  return {
    async get(tenantId: string): Promise<TenantFeatureFlags | null> {
      if (!UUID_RE.test(tenantId)) return null;
      const rows = await db
        .select(FLAG_COLUMNS)
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },

    async update(
      tenantId: string,
      patch: Partial<TenantFeatureFlags>,
    ): Promise<TenantFeatureFlags | null> {
      if (!UUID_RE.test(tenantId)) return null;
      const set = {
        ...(patch.canonEnabled !== undefined
          ? { canonEnabled: patch.canonEnabled }
          : {}),
        ...(patch.deliverabilityEnabled !== undefined
          ? { deliverabilityEnabled: patch.deliverabilityEnabled }
          : {}),
        ...(patch.evalEnabled !== undefined
          ? { evalEnabled: patch.evalEnabled }
          : {}),
      };
      if (Object.keys(set).length === 0) return this.get(tenantId);
      const rows = await db
        .update(tenants)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning(FLAG_COLUMNS);
      return rows[0] ?? null;
    },
  };
}
