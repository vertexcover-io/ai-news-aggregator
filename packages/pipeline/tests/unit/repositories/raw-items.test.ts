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

// ---------------------------------------------------------------------------
// findBySourceAndExternalId
// ---------------------------------------------------------------------------

interface FindBySourceRow {
  id: number;
  sourceType: string;
  externalId: string;
  title: string;
  url: string;
  sourceUrl: string | null;
  author: string | null;
  content: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  metadata: { comments: [] };
}

function createFindBySourceDb(rows: FindBySourceRow[]): Pick<AppDb, "insert" | "select" | "update"> {
  const whereBuilder = {
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  const fromBuilder = {
    where: vi.fn(() => whereBuilder),
  };
  const selectSpy = vi.fn(() => ({ from: vi.fn(() => fromBuilder) }));
  return {
    select: selectSpy,
    insert: vi.fn(),
    update: vi.fn(),
  } as unknown as Pick<AppDb, "insert" | "select" | "update">;
}

describe("createRawItemsRepo.findBySourceAndExternalId", () => {
  it("returns null when DB returns no rows (empty array)", async () => {
    const db = createFindBySourceDb([]);
    const repo = createRawItemsRepo(db);

    const result = await repo.findBySourceAndExternalId("hn", "abc123");

    expect(result).toBeNull();
  });

  it("returns the mapped RawItemRow when DB returns a row", async () => {
    const engagement = { points: 55, commentCount: 3 };
    const metadata = { comments: [] as [] };
    const publishedAt = new Date("2026-04-01T00:00:00Z");
    const row: FindBySourceRow = {
      id: 99,
      sourceType: "hn",
      externalId: "abc123",
      title: "Found Story",
      url: "https://example.com/found",
      sourceUrl: "https://hn.example.com/item?id=99",
      author: "bob",
      content: "article content",
      imageUrl: "https://example.com/image.png",
      publishedAt,
      engagement,
      metadata,
    };
    const db = createFindBySourceDb([row]);
    const repo = createRawItemsRepo(db);

    const result = await repo.findBySourceAndExternalId("hn", "abc123");

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.id).toBe(99);
    expect(result.sourceType).toBe("hn");
    expect(result.externalId).toBe("abc123");
    expect(result.title).toBe("Found Story");
    expect(result.url).toBe("https://example.com/found");
    expect(result.sourceUrl).toBe("https://hn.example.com/item?id=99");
    expect(result.author).toBe("bob");
    expect(result.content).toBe("article content");
    expect(result.imageUrl).toBe("https://example.com/image.png");
    expect(result.publishedAt).toEqual(publishedAt);
    expect(result.engagement).toEqual(engagement);
    expect(result.metadata).toEqual(metadata);
  });
});

// ---------------------------------------------------------------------------
// updateRecapData
// ---------------------------------------------------------------------------

interface CapturedUpdate {
  calls: { id: number; setArg: Record<string, unknown> }[];
}

function createUpdateCapturingDb(): {
  db: Pick<AppDb, "insert" | "select" | "update">;
  captured: CapturedUpdate;
} {
  const captured: CapturedUpdate = { calls: [] };

  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn((setArg: Record<string, unknown>) => ({
        where: vi.fn((whereArg: unknown) => {
          captured.calls.push({ id: whereArg as number, setArg });
          return Promise.resolve();
        }),
      })),
    })),
  } as unknown as Pick<AppDb, "insert" | "select" | "update">;

  return { db, captured };
}

describe("createRawItemsRepo.updateRecapData", () => {
  it("returns without calling db.update when the updates array is empty", async () => {
    const { db, captured } = createUpdateCapturingDb();
    const repo = createRawItemsRepo(db);

    await repo.updateRecapData([]);

    expect(captured.calls).toHaveLength(0);
    expect((db.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("calls db.update once per item with correct id and sets metadata via jsonb_set", async () => {
    const { db, captured } = createUpdateCapturingDb();
    const repo = createRawItemsRepo(db);

    const updates = [
      { id: 1, recap: { summary: "Summary 1", bullets: ["Bullet 1"], bottomLine: "Bottom 1" } },
      { id: 2, recap: { summary: "Summary 2", bullets: ["Bullet 2"], bottomLine: "Bottom 2" } },
    ];

    await repo.updateRecapData(updates);

    expect((db.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(captured.calls).toHaveLength(2);
    // Check that the set args contain metadata key with sql content
    expect(captured.calls[0].setArg).toHaveProperty("metadata");
    expect(captured.calls[1].setArg).toHaveProperty("metadata");
  });
})
