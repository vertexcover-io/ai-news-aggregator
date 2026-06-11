import { and, desc, eq, sql } from "drizzle-orm";
import { mustReadEntries } from "@newsletter/shared/db";
import type { AppDb, MustReadEntry } from "@newsletter/shared/db";
import type { PublicMustReadEntry } from "@newsletter/shared/types";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MustReadPublicEntry = Omit<MustReadEntry, "tenantId" | "updatedAt">;

export function toPublicWire(row: MustReadPublicEntry): PublicMustReadEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    author: row.author,
    year: row.year,
    annotation: row.annotation,
    addedAt: row.addedAt.toISOString(),
  };
}


export interface MustReadCreateInput {
  url: string;
  title: string;
  author: string | null;
  year: number | null;
  annotation: string;
}

export type MustReadPatch = Partial<MustReadCreateInput>;

export interface MustReadRepo {
  listPublic(): Promise<MustReadPublicEntry[]>;
  listAdmin(): Promise<MustReadEntry[]>;
  findById(id: string): Promise<MustReadEntry | null>;
  findByUrl(url: string): Promise<MustReadEntry | null>;
  findRandom(): Promise<MustReadEntry | null>;
  create(input: MustReadCreateInput): Promise<MustReadEntry>;
  update(id: string, patch: MustReadPatch): Promise<MustReadEntry | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export function createMustReadRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "delete" | "execute">,
  ctx: TenantContext,
): MustReadRepo {
  const publicColumns = {
    id: mustReadEntries.id,
    url: mustReadEntries.url,
    title: mustReadEntries.title,
    author: mustReadEntries.author,
    year: mustReadEntries.year,
    annotation: mustReadEntries.annotation,
    addedAt: mustReadEntries.addedAt,
  } as const;

  const tenantCondition = () =>
    ctx.allTenants ? undefined : eq(mustReadEntries.tenantId, ctx.tenantId);

  return {
    async listPublic(): Promise<MustReadPublicEntry[]> {
      const tc = tenantCondition();
      const query = db
        .select(publicColumns)
        .from(mustReadEntries)
        .$dynamic();
      return (tc ? query.where(tc) : query).orderBy(desc(mustReadEntries.addedAt));
    },

    async listAdmin(): Promise<MustReadEntry[]> {
      const tc = tenantCondition();
      const query = db
        .select()
        .from(mustReadEntries)
        .$dynamic();
      return (tc ? query.where(tc) : query).orderBy(desc(mustReadEntries.addedAt));
    },

    async findById(id: string): Promise<MustReadEntry | null> {
      if (!UUID_RE.test(id)) return null;
      const conditions = [eq(mustReadEntries.id, id)];
      if (!ctx.allTenants) conditions.push(eq(mustReadEntries.tenantId, ctx.tenantId));
      const rows = await db
        .select()
        .from(mustReadEntries)
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByUrl(url: string): Promise<MustReadEntry | null> {
      const conditions = [eq(mustReadEntries.url, url)];
      if (!ctx.allTenants) conditions.push(eq(mustReadEntries.tenantId, ctx.tenantId));
      const rows = await db
        .select()
        .from(mustReadEntries)
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    },

    async findRandom(): Promise<MustReadEntry | null> {
      const tc = tenantCondition();
      const query = db
        .select()
        .from(mustReadEntries)
        .$dynamic();
      const rows = await (tc ? query.where(tc) : query)
        .orderBy(sql`random()`)
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: MustReadCreateInput): Promise<MustReadEntry> {
      const [row] = await db
        .insert(mustReadEntries)
        .values({
          url: input.url,
          title: input.title,
          author: input.author,
          year: input.year,
          annotation: input.annotation,
          tenantId: ctx.tenantId,
        })
        .returning();
      return row;
    },

    async update(id: string, patch: MustReadPatch): Promise<MustReadEntry | null> {
      if (!UUID_RE.test(id)) return null;
      const setObj = {
        ...(patch.url !== undefined && { url: patch.url }),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.author !== undefined && { author: patch.author }),
        ...(patch.year !== undefined && { year: patch.year }),
        ...(patch.annotation !== undefined && { annotation: patch.annotation }),
        updatedAt: sql`now()`,
      };
      const conditions = [eq(mustReadEntries.id, id)];
      if (!ctx.allTenants) conditions.push(eq(mustReadEntries.tenantId, ctx.tenantId));
      const rows = await db
        .update(mustReadEntries)
        .set(setObj)
        .where(and(...conditions))
        .returning();
      return rows[0] ?? null;
    },

    async delete(id: string): Promise<boolean> {
      if (!UUID_RE.test(id)) return false;
      const conditions = [eq(mustReadEntries.id, id)];
      if (!ctx.allTenants) conditions.push(eq(mustReadEntries.tenantId, ctx.tenantId));
      const rows = await db
        .delete(mustReadEntries)
        .where(and(...conditions))
        .returning({ id: mustReadEntries.id });
      return rows.length === 1;
    },

    async count(): Promise<number> {
      const tc = tenantCondition();
      const query = db
        .select({ c: sql<number>`count(*)::int` })
        .from(mustReadEntries)
        .$dynamic();
      const rows = await (tc ? query.where(tc) : query);
      return rows[0]?.c ?? 0;
    },
  };
}
