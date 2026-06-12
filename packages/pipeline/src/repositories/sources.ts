import { and, asc, eq, sql } from "drizzle-orm";
import { sources } from "@newsletter/shared/db";
import type { AppDb, SourceConfig, SourceHealth, TenantSourceType } from "@newsletter/shared/db";
import type { SourceConfigByType } from "@newsletter/shared/services/sources-assembler";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SourceRecord = {
  [K in TenantSourceType]: {
    id: string;
    type: K;
    config: SourceConfigByType[K];
    enabled: boolean;
    health: SourceHealth | null;
    createdAt: Date;
    updatedAt: Date;
  };
}[TenantSourceType];

export type SourceCreateInput = {
  [K in TenantSourceType]: {
    type: K;
    config: SourceConfigByType[K];
    enabled?: boolean;
  };
}[TenantSourceType];

export interface SourceUpdateInput {
  config?: SourceConfig;
  enabled?: boolean;
}

export interface SourcesRepo {
  list(): Promise<SourceRecord[]>;
  listEnabled(): Promise<SourceRecord[]>;
  getById(id: string): Promise<SourceRecord | null>;
  create(input: SourceCreateInput): Promise<SourceRecord>;
  update(id: string, patch: SourceUpdateInput): Promise<SourceRecord | null>;
  delete(id: string): Promise<boolean>;
  updateHealth(id: string, health: SourceHealth | null): Promise<SourceRecord | null>;
}

function toDomain(row: typeof sources.$inferSelect): SourceRecord {
  return {
    id: row.id,
    type: row.type,
    config: row.config,
    enabled: row.enabled,
    health: row.health ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as SourceRecord;
}

export function createSourcesRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete">,
  tenantId: string,
): SourcesRepo {
  return {
    async list(): Promise<SourceRecord[]> {
      const rows = await db
        .select()
        .from(sources)
        .where(eq(sources.tenantId, tenantId))
        .orderBy(asc(sources.type), asc(sources.createdAt), asc(sources.id));
      return rows.map(toDomain);
    },

    async listEnabled(): Promise<SourceRecord[]> {
      const rows = await db
        .select()
        .from(sources)
        .where(and(eq(sources.tenantId, tenantId), eq(sources.enabled, true)))
        .orderBy(asc(sources.type), asc(sources.createdAt), asc(sources.id));
      return rows.map(toDomain);
    },

    async getById(id: string): Promise<SourceRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select()
        .from(sources)
        .where(and(eq(sources.tenantId, tenantId), eq(sources.id, id)))
        .limit(1);
      return rows[0] ? toDomain(rows[0]) : null;
    },

    async create(input: SourceCreateInput): Promise<SourceRecord> {
      const [row] = await db
        .insert(sources)
        .values({
          tenantId,
          type: input.type,
          config: input.config,
          enabled: input.enabled ?? true,
        })
        .returning();
      return toDomain(row);
    },

    async update(id: string, patch: SourceUpdateInput): Promise<SourceRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(sources)
        .set({
          ...(patch.config !== undefined ? { config: patch.config } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          updatedAt: sql`now()`,
        })
        .where(and(eq(sources.tenantId, tenantId), eq(sources.id, id)))
        .returning();
      return rows[0] ? toDomain(rows[0]) : null;
    },

    async delete(id: string): Promise<boolean> {
      if (!UUID_RE.test(id)) return false;
      const rows = await db
        .delete(sources)
        .where(and(eq(sources.tenantId, tenantId), eq(sources.id, id)))
        .returning({ id: sources.id });
      return rows.length === 1;
    },

    async updateHealth(id: string, health: SourceHealth | null): Promise<SourceRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(sources)
        .set({ health, updatedAt: sql`now()` })
        .where(and(eq(sources.tenantId, tenantId), eq(sources.id, id)))
        .returning();
      return rows[0] ? toDomain(rows[0]) : null;
    },
  };
}
