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
  /** All rows for the tenant (enabled or not). The health-check rows overlay
   * mirrors GET /settings — it includes disabled rows so an explicit check of a
   * temporarily-disabled collector still sees its config (FIX #6). */
  list(): Promise<SourceRow[]>;
  /** The rows collection will run from (P9, REQ-073): tenant + enabled only. */
  listEnabled(): Promise<SourceRow[]>;
  /**
   * True when the tenant has ANY sources rows (enabled or not). Distinguishes
   * "not yet lifted to rows — fall back to user_settings JSONB" from "all
   * rows disabled — collect nothing" (REQ-073).
   */
  hasAny(): Promise<boolean>;
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
    async list(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(tenantScoped(sources.tenantId, ctx))
        .orderBy(asc(sources.createdAt), asc(sources.id));
    },

    async listEnabled(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(tenantScoped(sources.tenantId, ctx, eq(sources.enabled, true)))
        .orderBy(asc(sources.createdAt), asc(sources.id));
    },

    async hasAny(): Promise<boolean> {
      const rows = await db
        .select({ id: sources.id })
        .from(sources)
        .where(tenantScoped(sources.tenantId, ctx))
        .limit(1);
      return rows.length > 0;
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
