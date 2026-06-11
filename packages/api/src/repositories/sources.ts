import { and, eq } from "drizzle-orm";
import { sources } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface SourceRecord {
  id: string;
  tenantId: string | null;
  type: SourceType;
  config: Record<string, unknown>;
  enabled: boolean;
  lastHealth: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceCreateInput {
  type: SourceType;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface SourcesRepo {
  listForTenant(): Promise<SourceRecord[]>;
  findById(id: string): Promise<SourceRecord | null>;
  create(input: SourceCreateInput): Promise<SourceRecord>;
  updateEnabled(id: string, enabled: boolean): Promise<SourceRecord | null>;
  delete(id: string): Promise<boolean>;
}

export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete">,
  ctx: TenantContext,
): SourcesRepo {
  const tenantWhere = ctx.allTenants
    ? undefined
    : eq(sources.tenantId, ctx.tenantId);

  return {
    async listForTenant(): Promise<SourceRecord[]> {
      const query = db.select().from(sources).$dynamic();
      return tenantWhere ? query.where(tenantWhere) : query;
    },

    async findById(id: string): Promise<SourceRecord | null> {
      const conditions = [eq(sources.id, id)];
      if (tenantWhere) conditions.push(tenantWhere);
      const rows = await db
        .select()
        .from(sources)
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: SourceCreateInput): Promise<SourceRecord> {
      const [row] = await db
        .insert(sources)
        .values({
          type: input.type,
          config: input.config,
          enabled: input.enabled ?? true,
          tenantId: ctx.tenantId,
        })
        .returning();
      return row;
    },

    async updateEnabled(id: string, enabled: boolean): Promise<SourceRecord | null> {
      const conditions = [eq(sources.id, id)];
      if (tenantWhere) conditions.push(tenantWhere);
      const rows = await db
        .update(sources)
        .set({ enabled, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      return rows[0] ?? null;
    },

    async delete(id: string): Promise<boolean> {
      const conditions = [eq(sources.id, id)];
      if (tenantWhere) conditions.push(tenantWhere);
      const result = await db
        .delete(sources)
        .where(and(...conditions))
        .returning({ id: sources.id });
      return result.length > 0;
    },
  };
}
