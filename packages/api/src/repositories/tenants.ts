import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb, TenantRow } from "@newsletter/shared/db";
import type { TenantStatus } from "@newsletter/shared/types/tenant";

export interface CreateTenantInput {
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface TenantsRepo {
  findById(id: string): Promise<TenantRow | null>;
  findBySlug(slug: string): Promise<TenantRow | null>;
  create(input: CreateTenantInput): Promise<TenantRow>;
}

export function createTenantsRepo(
  db: Pick<AppDb, "select" | "insert">,
): TenantsRepo {
  return {
    async findById(id: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findBySlug(slug: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async create(input: CreateTenantInput): Promise<TenantRow> {
      const [row] = await db
        .insert(tenants)
        .values({ slug: input.slug, name: input.name, status: input.status })
        .returning();
      return row;
    },
  };
}
