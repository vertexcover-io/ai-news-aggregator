import { eq } from "drizzle-orm";
import { sources, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SourceInsert, SourceRow, TenantContext } from "@newsletter/shared";

export interface SourcesRepo {
  listForTenant(): Promise<SourceRow[]>;
  listEnabled(): Promise<SourceRow[]>;
  add(insert: Omit<SourceInsert, "tenantId">): Promise<SourceRow>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<SourceRow>;
}

export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete">,
  ctx?: TenantContext,
): SourcesRepo {
  const scope = tenantScope(sources.tenantId, ctx);
  return {
    async listForTenant(): Promise<SourceRow[]> {
      return db.select().from(sources).where(scope.where());
    },

    async listEnabled(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(scope.where(eq(sources.enabled, true)));
    },

    async add(insert: Omit<SourceInsert, "tenantId">): Promise<SourceRow> {
      const [row] = await db.insert(sources).values(scope.stamp(insert)).returning();
      return row;
    },

    async remove(id: string): Promise<void> {
      await db.delete(sources).where(scope.where(eq(sources.id, id)));
    },

    async setEnabled(id: string, enabled: boolean): Promise<SourceRow> {
      const [row] = await db
        .update(sources)
        .set({ enabled, updatedAt: new Date() })
        .where(scope.where(eq(sources.id, id)))
        .returning();
      return row;
    },
  };
}
