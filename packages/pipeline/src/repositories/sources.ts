import { asc, eq } from "drizzle-orm";
import { scopedTenantId, sources, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, SourceRow, TenantScope } from "@newsletter/shared/db";
import type { SourceConfig } from "@newsletter/shared/types";
import type { SourceType } from "@newsletter/shared";

export interface PipelineSourceCreateInput {
  type: SourceType;
  config: SourceConfig;
  enabled?: boolean;
}

export interface SourcesRepo {
  /** The rows collection will run from (P9, REQ-073): tenant + enabled only. */
  listEnabled(): Promise<SourceRow[]>;
  create(input: PipelineSourceCreateInput): Promise<SourceRow>;
}

/**
 * Tenant-scoped sources repository for pipeline workers (P8, REQ-070).
 * Construct with the per-job tenant context (P9) or the single-tenant bridge
 * (`getDefaultTenantScope()`) until then. `sources.tenant_id` is NOT NULL
 * with no DB DEFAULT — writes require a concrete TenantContext.
 */
export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert">,
  ctx?: TenantScope,
): SourcesRepo {
  return {
    async listEnabled(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(tenantScoped(sources.tenantId, ctx, eq(sources.enabled, true)))
        .orderBy(asc(sources.createdAt), asc(sources.id));
    },

    async create(input: PipelineSourceCreateInput): Promise<SourceRow> {
      const tenantId = scopedTenantId(ctx);
      if (tenantId === undefined) {
        throw new Error("sources.create requires a concrete tenant context");
      }
      const [row] = await db
        .insert(sources)
        .values({
          tenantId,
          type: input.type,
          config: input.config,
          enabled: input.enabled ?? true,
        })
        .returning();
      return row;
    },
  };
}
