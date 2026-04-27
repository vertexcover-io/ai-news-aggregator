import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { createCandidatesRepo } from "@pipeline/repositories/candidates";
import type { AppDb } from "@newsletter/shared/db";

interface CapturedQuery {
  whereArg: SQL | undefined;
  fromCalled: boolean;
}

interface FakeDbResult {
  db: Pick<AppDb, "select">;
  selectSpy: ReturnType<typeof vi.fn>;
  captured: CapturedQuery;
}

interface FakeRow {
  id: number;
  title: string;
  url: string;
  sourceType: string;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  metadata: { comments: [] };
}

function createFakeDb(rows: FakeRow[]): FakeDbResult {
  const captured: CapturedQuery = { whereArg: undefined, fromCalled: false };

  const whereThenable = {
    then: (
      resolve: (value: FakeRow[]) => unknown,
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

  const db = {
    select: selectSpy,
  } as unknown as Pick<AppDb, "select">;

  return { db, selectSpy, captured };
}

interface ColumnLike {
  name: string;
}

function isColumnLike(value: unknown): value is ColumnLike {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || !("table" in value)) return false;
  return typeof value.name === "string";
}

function collectColumnNames(node: unknown, seen = new WeakSet()): string[] {
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

describe("createCandidatesRepo.findSince", () => {
  it("returns [] immediately without calling db.select when sourceTypes is empty", async () => {
    const { db, selectSpy } = createFakeDb([]);
    const repo = createCandidatesRepo(db);

    const result = await repo.findSince(new Date(), []);

    expect(result).toEqual([]);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("returns the mapped rows when DB returns results", async () => {
    const engagement = { points: 42, commentCount: 7 };
    const metadata = { comments: [] as [] };
    const publishedAt = new Date("2026-04-01T00:00:00Z");
    const rows: FakeRow[] = [
      {
        id: 101,
        title: "Test Story",
        url: "https://example.com/story",
        sourceType: "hn",
        author: "alice",
        publishedAt,
        engagement,
        content: "some content",
        metadata,
      },
    ];
    const { db } = createFakeDb(rows);
    const repo = createCandidatesRepo(db);

    const result = await repo.findSince(new Date("2026-03-01T00:00:00Z"), ["hn"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
    expect(result[0].title).toBe("Test Story");
    expect(result[0].url).toBe("https://example.com/story");
    expect(result[0].sourceType).toBe("hn");
    expect(result[0].author).toBe("alice");
    expect(result[0].publishedAt).toEqual(publishedAt);
    expect(result[0].engagement).toEqual(engagement);
    expect(result[0].content).toBe("some content");
    expect(result[0].metadata).toEqual(metadata);
  });

  it("builds a where clause referencing collected_at and source_type columns", async () => {
    const { db, captured } = createFakeDb([]);
    const repo = createCandidatesRepo(db);

    await repo.findSince(new Date("2026-04-01T00:00:00Z"), ["hn", "reddit"]);

    expect(captured.fromCalled).toBe(true);
    expect(captured.whereArg).toBeDefined();

    const referencedColumns = collectColumnNames(captured.whereArg);
    expect(referencedColumns).toContain("collected_at");
    expect(referencedColumns).toContain("source_type");
  });
});
