import { and, eq } from "drizzle-orm";
import { sources } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface PipelineSourceRecord {
  id: string;
  tenantId: string | null;
  type: SourceType;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface PipelineSourcesRepo {
  listEnabled(): Promise<PipelineSourceRecord[]>;
}

export function createSourcesRepo(
  db: Pick<AppDb, "select">,
  ctx: TenantContext,
): PipelineSourcesRepo {
  const tenantWhere = ctx.allTenants
    ? undefined
    : eq(sources.tenantId, ctx.tenantId);

  return {
    async listEnabled(): Promise<PipelineSourceRecord[]> {
      const conditions = [eq(sources.enabled, true)];
      if (tenantWhere) conditions.push(tenantWhere);
      return db
        .select()
        .from(sources)
        .where(and(...conditions));
    },
  };
}
