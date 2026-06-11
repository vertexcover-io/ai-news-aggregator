import { desc, eq, sql } from "drizzle-orm";
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
  /**
   * Most recently renamed tenant whose pre-rename slug matches (P5,
   * REQ-023/EDGE-002 — the resolver 301-redirects old slug hosts).
   */
  findByPreviousSlug(slug: string): Promise<TenantRow | null>;
  create(input: CreateTenantInput): Promise<TenantRow>;
  /** Sets the new slug and records the outgoing one in `previousSlug`. */
  updateSlug(id: string, newSlug: string): Promise<TenantRow | null>;
}

export function createTenantsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
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

    async findByPreviousSlug(slug: string): Promise<TenantRow | null> {
      // Most recent rename wins if several tenants ever held the same slug.
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.previousSlug, slug))
        .orderBy(desc(tenants.updatedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateSlug(id: string, newSlug: string): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({
          previousSlug: sql`${tenants.slug}`,
          slug: newSlug,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning();
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
