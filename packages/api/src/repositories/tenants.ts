import { count, eq } from "drizzle-orm";
import { tenants, users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantInsert, TenantRow, TenantStatus } from "@newsletter/shared";

export interface TenantBrandingUpdate {
  name?: string | null;
  headline?: string | null;
  topicStrip?: string | null;
  subtagline?: string | null;
  logoBytes?: string | null;
  logoContentType?: string | null;
  logoVersion?: number;
  customDomain?: string | null;
  canonEnabled?: boolean;
  deliverabilityEnabled?: boolean;
  evalEnabled?: boolean;
  builtPageEnabled?: boolean;
}

export interface TenantListEntry extends TenantRow {
  readonly userCount: number;
}

export interface TenantsRepo {
  create(insert: Pick<TenantInsert, "slug"> & Partial<TenantInsert>): Promise<TenantRow>;
  getById(id: string): Promise<TenantRow | null>;
  getBySlug(slug: string): Promise<TenantRow | null>;
  getByCustomDomain(domain: string): Promise<TenantRow | null>;
  getByPreviousSlug(slug: string): Promise<TenantRow | null>;
  list(): Promise<TenantListEntry[]>;
  updateBranding(id: string, update: TenantBrandingUpdate): Promise<TenantRow>;
  updateStatus(id: string, status: TenantStatus): Promise<TenantRow>;
  updateSlug(id: string, slug: string, previousSlug: string): Promise<TenantRow>;
  isSlugAvailable(slug: string): Promise<boolean>;
}

export function createTenantsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
): TenantsRepo {
  return {
    async create(
      insert: Pick<TenantInsert, "slug"> & Partial<TenantInsert>,
    ): Promise<TenantRow> {
      const [row] = await db
        .insert(tenants)
        .values({ status: "pending_setup", ...insert })
        .returning();
      return row;
    },

    async getById(id: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async getBySlug(slug: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async getByCustomDomain(domain: string): Promise<TenantRow | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.customDomain, domain))
        .limit(1);
      return rows[0] ?? null;
    },

    async getByPreviousSlug(slug: string): Promise<TenantRow | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.previousSlug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async list(): Promise<TenantListEntry[]> {
      const rows = await db.select().from(tenants);
      const entries: TenantListEntry[] = [];
      for (const row of rows) {
        const [c] = await db
          .select({ value: count() })
          .from(users)
          .where(eq(users.tenantId, row.id));
        entries.push({ ...row, userCount: c.value });
      }
      return entries;
    },

    async updateBranding(id: string, update: TenantBrandingUpdate): Promise<TenantRow> {
      const [row] = await db
        .update(tenants)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return row;
    },

    async updateStatus(id: string, status: TenantStatus): Promise<TenantRow> {
      const [row] = await db
        .update(tenants)
        .set({ status, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return row;
    },

    async updateSlug(id: string, slug: string, previousSlug: string): Promise<TenantRow> {
      const [row] = await db
        .update(tenants)
        .set({ slug, previousSlug, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return row;
    },

    async isSlugAvailable(slug: string): Promise<boolean> {
      const rows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return rows.length === 0;
    },
  };
}
