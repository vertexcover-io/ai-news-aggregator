import { desc, eq, sql } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext, BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import { mustReadEntries } from "@newsletter/shared/db";
import type { AppDb, MustReadEntry } from "@newsletter/shared/db";
import type { PublicMustReadEntry } from "@newsletter/shared/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MustReadPublicEntry = Omit<MustReadEntry, "updatedAt">;

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
  db: Pick<AppDb, "select" | "insert" | "update" | "delete" | "execute">, scoped: ScopedTenantContext,
): MustReadRepo {
  const publicColumns = {
    id: mustReadEntries.id,
    tenantId: mustReadEntries.tenantId,
    url: mustReadEntries.url,
    title: mustReadEntries.title,
    author: mustReadEntries.author,
    year: mustReadEntries.year,
    annotation: mustReadEntries.annotation,
    addedAt: mustReadEntries.addedAt,
  } as const;

  return {
    async listPublic(): Promise<MustReadPublicEntry[]> {
      return db
        .select(publicColumns)
        .from(mustReadEntries)
        .orderBy(desc(mustReadEntries.addedAt));
    },

    async listAdmin(): Promise<MustReadEntry[]> {
      return db
        .select()
        .from(mustReadEntries)
        .orderBy(desc(mustReadEntries.addedAt));
    },

    async findById(id: string): Promise<MustReadEntry | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select()
        .from(mustReadEntries)
        .where(eq(mustReadEntries.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByUrl(url: string): Promise<MustReadEntry | null> {
      const rows = await db
        .select()
        .from(mustReadEntries)
        .where(eq(mustReadEntries.url, url))
        .limit(1);
      return rows[0] ?? null;
    },

    async findRandom(): Promise<MustReadEntry | null> {
      const rows = await db
        .select()
        .from(mustReadEntries)
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
      const rows = await db
        .update(mustReadEntries)
        .set(setObj)
        .where(eq(mustReadEntries.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async delete(id: string): Promise<boolean> {
      if (!UUID_RE.test(id)) return false;
      const rows = await db
        .delete(mustReadEntries)
        .where(eq(mustReadEntries.id, id))
        .returning({ id: mustReadEntries.id });
      return rows.length === 1;
    },

    async count(): Promise<number> {
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(mustReadEntries);
      return row.c;
    },
  };
}
