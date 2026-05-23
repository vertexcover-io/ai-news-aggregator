import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";

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

interface CapturedUpsert {
  setArg: Record<string, unknown> | null;
  valuesCalled: boolean;
}

function createUpsertCapturingDb(): {
  db: Pick<AppDb, "insert" | "select">;
  captured: CapturedUpsert;
} {
  const captured: CapturedUpsert = { setArg: null, valuesCalled: false };

  const valuesBuilder = {
    onConflictDoUpdate: (
      arg: { set: Record<string, unknown> },
    ): Promise<unknown> => {
      captured.setArg = arg.set;
      return Promise.resolve();
    },
  };

  const insertBuilder = {
    values: (): typeof valuesBuilder => {
      captured.valuesCalled = true;
      return valuesBuilder;
    },
  };

  const db = {
    insert: vi.fn(() => insertBuilder),
    select: vi.fn(),
  } as unknown as Pick<AppDb, "insert" | "select">;

  return { db, captured };
}

interface CapturedUpsertFull {
  valuesArg: RawItemInsert[] | null;
  setArg: Record<string, unknown> | null;
  valuesCalled: boolean;
}

function createUpsertCapturingDbFull(): {
  db: Pick<AppDb, "insert" | "select" | "update">;
  captured: CapturedUpsertFull;
} {
  const captured: CapturedUpsertFull = {
    valuesArg: null,
    setArg: null,
    valuesCalled: false,
  };

  const valuesBuilder = {
    onConflictDoUpdate: (
      arg: { set: Record<string, unknown> },
    ): Promise<unknown> => {
      captured.setArg = arg.set;
      return Promise.resolve();
    },
  };

  const insertBuilder = {
    values: (items: RawItemInsert[]): typeof valuesBuilder => {
      captured.valuesCalled = true;
      captured.valuesArg = items;
      return valuesBuilder;
    },
  };

  const db = {
    insert: vi.fn(() => insertBuilder),
    select: vi.fn(),
    update: vi.fn(),
  } as unknown as Pick<AppDb, "insert" | "select" | "update">;

  return { db, captured };
}

// Regression: re-collected items must surface in the next ranking window.
// Bug: collectedAt was not bumped on conflict, so HN/Reddit re-runs were
// silently filtered out by loadCandidatesSince's `gte(collectedAt, since)`.
describe("createRawItemsRepo.upsertItems", () => {
  it("bumps collectedAt on conflict so re-collected items stay in the loader window", async () => {
    const { db, captured } = createUpsertCapturingDb();
    const repo = createRawItemsRepo(db);

    const item: RawItemInsert = {
      sourceType: "hn",
      externalId: "12345",
      title: "Some title",
      url: "https://news.ycombinator.com/item?id=12345",
      author: "alice",
      content: null,
      publishedAt: new Date("2026-04-01T00:00:00Z"),
      collectedAt: new Date("2026-04-01T00:00:00Z"),
      engagement: { points: 10, commentCount: 2 },
      metadata: { comments: [] },
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    };

    await repo.upsertItems([item]);

    expect(captured.valuesCalled).toBe(true);
    if (captured.setArg === null) throw new Error("expected upsert set arg");
    expect(Object.keys(captured.setArg)).toContain("collectedAt");
    expect(captured.setArg.collectedAt).toBeInstanceOf(Date);
  });

  // VS-4a (REQ-002): upsertItems with items carrying runId persists run_id
  it("VS-4a: includes runId in onConflictDoUpdate set clause when items carry runId", async () => {
    const { db, captured } = createUpsertCapturingDbFull();
    const repo = createRawItemsRepo(db);

    const item: RawItemInsert = {
      sourceType: "hn",
      externalId: "42",
      title: "Title",
      url: "https://hn.example/42",
      author: "bob",
      content: null,
      publishedAt: new Date("2026-05-01T00:00:00Z"),
      collectedAt: new Date("2026-05-01T00:00:00Z"),
      engagement: { points: 5, commentCount: 1 },
      metadata: { comments: [] },
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      runId: "run-abc",
    };

    await repo.upsertItems([item]);

    expect(captured.valuesCalled).toBe(true);
    if (captured.setArg === null) throw new Error("expected upsert set arg");
    expect(Object.keys(captured.setArg)).toContain("runId");
  });

  // VS-4b (REQ-003): upsertItems called without runId does not error; item has no runId stamped
  it("VS-4b: upsertItems succeeds when item has no runId (add-post path leaves run_id NULL)", async () => {
    const { db, captured } = createUpsertCapturingDbFull();
    const repo = createRawItemsRepo(db);

    const item: RawItemInsert = {
      sourceType: "blog",
      externalId: "post-1",
      title: "A blog post",
      url: "https://blog.example/post-1",
      author: null,
      content: null,
      publishedAt: null,
      collectedAt: new Date("2026-05-01T00:00:00Z"),
      engagement: { points: 0, commentCount: 0 },
      metadata: { comments: [] },
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      // no runId — add-post path
    };

    // Must not throw
    await expect(repo.upsertItems([item])).resolves.toBeUndefined();

    expect(captured.valuesCalled).toBe(true);
    // The inserted item must not carry a runId (no stamping on this path)
    if (captured.valuesArg === null) throw new Error("expected valuesArg");
    expect(captured.valuesArg[0].runId).toBeUndefined();
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
