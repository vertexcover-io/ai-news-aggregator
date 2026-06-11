import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantStatus } from "@newsletter/shared/types/tenant";

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantsRepo {
  create(tenant: { slug: string; name: string; status: TenantStatus }): Promise<TenantRecord>;
  findById(id: string): Promise<TenantRecord | null>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
}

export function createTenantsRepo(db: AppDb): TenantsRepo {
  return {
    async create(tenant) {
      const rows = await db
        .insert(tenants)
        .values({
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
        })
        .returning();
      const row = rows[0];
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async findById(id: string) {
      const rows = await db
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, createdAt: tenants.createdAt, updatedAt: tenants.updatedAt })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return row;
    },

    async findBySlug(slug: string) {
      const rows = await db
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, createdAt: tenants.createdAt, updatedAt: tenants.updatedAt })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return row;
    },
  };
}
