import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { sources } from "@newsletter/shared/db";
import type { AppDb, SourceInsert, SourceSelect, SourceHealth } from "@newsletter/shared/db";

export interface SourcesRepo {
  list(): Promise<SourceSelect[]>;
  getById(id: string): Promise<SourceSelect | null>;
  create(input: { type: SourceInsert["type"]; config?: Record<string, unknown> | null; enabled?: boolean }): Promise<SourceSelect>;
  update(id: string, patch: { config?: Record<string, unknown> | null; enabled?: boolean; lastHealth?: SourceHealth | null }): Promise<SourceSelect | null>;
  delete(id: string): Promise<boolean>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete">, scoped: ScopedTenantContext,
): SourcesRepo {
  const tid = () => isAllTenants(scoped) ? [] : [eq(sources.tenantId, scoped.ctx.tenantId)];

  return {
    async list(): Promise<SourceSelect[]> {
      return db
        .select()
        .from(sources)
        .where(and(...tid()))
        .orderBy(sources.createdAt);
    },

    async getById(id: string): Promise<SourceSelect | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select()
        .from(sources)
        .where(and(eq(sources.id, id), ...tid()))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: { type: SourceInsert["type"]; config?: Record<string, unknown> | null; enabled?: boolean }): Promise<SourceSelect> {
      const [row] = await db
        .insert(sources)
        .values({
          ...(isAllTenants(scoped) ? { tenantId: (scoped.ctx as { tenantId: string }).tenantId } : { tenantId: scoped.ctx.tenantId }),
          type: input.type,
          config: input.config ?? null,
          enabled: input.enabled ?? true,
        })
        .returning();
      return row;
    },

    async update(id: string, patch: { config?: Record<string, unknown> | null; enabled?: boolean; lastHealth?: SourceHealth | null }): Promise<SourceSelect | null> {
      if (!UUID_RE.test(id)) return null;
      const setObj: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (patch.config !== undefined) setObj.config = patch.config;
      if (patch.enabled !== undefined) setObj.enabled = patch.enabled;
      if (patch.lastHealth !== undefined) setObj.lastHealth = patch.lastHealth;

      const rows = await db
        .update(sources)
        .set(setObj as never)
        .where(and(eq(sources.id, id), ...tid()))
        .returning();
      return rows[0] ?? null;
    },

    async delete(id: string): Promise<boolean> {
      if (!UUID_RE.test(id)) return false;
      const rows = await db
        .delete(sources)
        .where(and(eq(sources.id, id), ...tid()))
        .returning({ id: sources.id });
      return rows.length === 1;
    },
  };
}
