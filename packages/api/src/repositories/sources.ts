import { desc, eq, sql } from "drizzle-orm";
import { scopedTenantId, sources, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, SourceRow, TenantScope } from "@newsletter/shared/db";
import {
  sourceDisplayName,
  type SourceConfig,
  type TenantSourceWire,
} from "@newsletter/shared/types";
import type { SourceType } from "@newsletter/shared";

/** Wire mapping for the Settings panel (routes must not touch db types). */
export function toSourceWire(row: SourceRow): TenantSourceWire {
  return {
    id: row.id,
    type: row.type,
    name: sourceDisplayName(row.config),
    config: row.config,
    enabled: row.enabled,
    health: row.lastHealth,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SourceCreateInput {
  type: SourceType;
  config: SourceConfig;
  enabled?: boolean;
}

export interface SourcesRepo {
  list(): Promise<SourceRow[]>;
  create(input: SourceCreateInput): Promise<SourceRow>;
  setEnabled(id: string, enabled: boolean): Promise<SourceRow | null>;
  delete(id: string): Promise<boolean>;
  /**
   * Atomically replace the tenant's entire source set with `inputs`
   * (delete-all + insert) — the PUT /settings reconcile, which mirrors the
   * card's collector configs back onto rows. Runs in a transaction so a
   * concurrent run never observes an empty source set mid-save.
   */
  replaceAll(inputs: readonly SourceCreateInput[]): Promise<void>;
}

/**
 * Tenant-scoped sources repository (P8, REQ-070/072). Reads are fenced by
 * `tenantScoped`; inserts stamp the scoped tenant id — `sources.tenant_id`
 * is NOT NULL with no DB DEFAULT, so a concrete TenantContext is required
 * for writes (every caller is behind requireAuth or the pipeline's default
 * tenant bridge).
 */
export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete" | "transaction">,
  ctx?: TenantScope,
): SourcesRepo {
  return {
    async list(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(tenantScoped(sources.tenantId, ctx))
        .orderBy(desc(sources.createdAt), desc(sources.id));
    },

    async create(input: SourceCreateInput): Promise<SourceRow> {
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

    async setEnabled(id: string, enabled: boolean): Promise<SourceRow | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(sources)
        .set({ enabled, updatedAt: sql`now()` })
        .where(tenantScoped(sources.tenantId, ctx, eq(sources.id, id)))
        .returning();
      return rows[0] ?? null;
    },

    async delete(id: string): Promise<boolean> {
      if (!UUID_RE.test(id)) return false;
      const rows = await db
        .delete(sources)
        .where(tenantScoped(sources.tenantId, ctx, eq(sources.id, id)))
        .returning({ id: sources.id });
      return rows.length === 1;
    },

    async replaceAll(inputs: readonly SourceCreateInput[]): Promise<void> {
      const tenantId = scopedTenantId(ctx);
      if (tenantId === undefined) {
        throw new Error("sources.replaceAll requires a concrete tenant context");
      }
      await db.transaction(async (tx) => {
        await tx.delete(sources).where(tenantScoped(sources.tenantId, ctx));
        if (inputs.length > 0) {
          await tx.insert(sources).values(
            inputs.map((input) => ({
              tenantId,
              type: input.type,
              config: input.config,
              enabled: input.enabled ?? true,
            })),
          );
        }
      });
    },
  };
}
