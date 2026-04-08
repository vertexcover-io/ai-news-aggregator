import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items";
import type { AppDb } from "@newsletter/shared/db";

interface CapturedQuery {
  whereArg: SQL | undefined;
  fromCalled: boolean;
}

interface FakeDbResult {
  db: Pick<AppDb, "insert" | "select">;
  selectSpy: ReturnType<typeof vi.fn>;
  captured: CapturedQuery;
}

function createFakeDb(rows: { externalId: string }[]): FakeDbResult {
  const captured: CapturedQuery = { whereArg: undefined, fromCalled: false };

  const whereThenable = {
    then: (
      resolve: (value: { externalId: string }[]) => unknown,
    ): Promise<unknown> => Promise.resolve(rows).then(resolve),
  };

  const fromBuilder = {
    where: (arg: SQL): typeof whereThenable => {
      captured.whereArg = arg;
      return whereThenable;
    },
  };

  const selectBuilder = {
    from: (): typeof fromBuilder => {
      captured.fromCalled = true;
      return fromBuilder;
    },
  };

  const selectSpy = vi.fn(() => selectBuilder);
  const insertSpy = vi.fn();

  const db = {
    select: selectSpy,
    insert: insertSpy,
  } as unknown as Pick<AppDb, "insert" | "select">;

  return { db, selectSpy, captured };
}

// REQ-030: dedup pre-check via findExistingExternalIds
describe("createRawItemsRepo.findExistingExternalIds", () => {
  it("REQ-030: returns empty Set without calling db.select when input is empty", async () => {
    const { db, selectSpy } = createFakeDb([]);
    const repo = createRawItemsRepo(db);

    const result = await repo.findExistingExternalIds("blog", []);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("REQ-030: returns Set of size 2 containing only DB-returned IDs when 3 IDs queried and 2 found", async () => {
    const { db } = createFakeDb([
      { externalId: "a" },
      { externalId: "c" },
    ]);
    const repo = createRawItemsRepo(db);

    const result = await repo.findExistingExternalIds("blog", ["a", "b", "c"]);

    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("c")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("REQ-030: returns empty Set when DB returns 0 rows for non-empty input", async () => {
    const { db } = createFakeDb([]);
    const repo = createRawItemsRepo(db);

    const result = await repo.findExistingExternalIds("blog", ["a", "b", "c"]);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it("REQ-030: applies sourceType and externalId filters in the where clause", async () => {
    const { db, captured } = createFakeDb([{ externalId: "a" }]);
    const repo = createRawItemsRepo(db);

    await repo.findExistingExternalIds("blog", ["a", "b"]);

    expect(captured.fromCalled).toBe(true);
    expect(captured.whereArg).toBeDefined();

    const referencedColumns = collectColumnNames(captured.whereArg);
    expect(referencedColumns).toContain("source_type");
    expect(referencedColumns).toContain("external_id");
  });
});

interface ColumnLike {
  name: string;
}

function isColumnLike(value: unknown): value is ColumnLike {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || !("table" in value)) return false;
  return typeof value.name === "string";
}

function collectColumnNames(
  node: unknown,
  seen = new WeakSet(),
): string[] {
  if (node === null || typeof node !== "object") return [];
  if (seen.has(node)) return [];
  seen.add(node);

  if (isColumnLike(node)) return [node.name];

  const out: string[] = [];
  if (Array.isArray(node)) {
    for (const item of node) out.push(...collectColumnNames(item, seen));
    return out;
  }
  for (const value of Object.values(node)) {
    out.push(...collectColumnNames(value, seen));
  }
  return out;
}
