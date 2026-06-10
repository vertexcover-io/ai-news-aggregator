import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { sources } from "@newsletter/shared/db";
import type { AppDb, SourceSelect } from "@newsletter/shared/db";

export interface PipelineSourcesRepo {
  /** List all enabled sources for the tenant — used by collection workers. */
  listEnabled(): Promise<SourceSelect[]>;
}

export function createSourcesRepo(
  db: Pick<AppDb, "select">, scoped: ScopedTenantContext,
): PipelineSourcesRepo {
  const tid = () => isAllTenants(scoped) ? [] : [eq(sources.tenantId, scoped.ctx.tenantId)];

  return {
    async listEnabled(): Promise<SourceSelect[]> {
      return db
        .select()
        .from(sources)
        .where(and(eq(sources.enabled, true), ...tid()))
        .orderBy(sources.createdAt);
    },
  };
}
