import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type { CandidateRow } from "@pipeline/repositories/candidates.js";
import type { RawItemMetadata } from "@newsletter/shared";

interface CapturedQuery {
  whereArg: SQL | undefined;
  fromCalled: boolean;
}

interface FakeDbResult {
  db: Pick<AppDb, "select">;
  selectSpy: ReturnType<typeof vi.fn>;
  captured: CapturedQuery;
}

function createFakeDb(rows: CandidateRow[]): FakeDbResult {
  const captured: CapturedQuery = { whereArg: undefined, fromCalled: false };

  const whereThenable = {
    then: (
      resolve: (value: CandidateRow[]) => unknown,
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

function baseRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 1,
    title: "Test title",
    url: "https://example.com",
    sourceType: "hn" as SourceType,
    author: null,
    publishedAt: new Date("2026-04-20T10:00:00Z"),
    engagement: { points: 10, commentCount: 2 },
    content: null,
    metadata: { comments: [] } as RawItemMetadata,
    ...overrides,
  };
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
  it("returns empty array without calling db when sourceTypes is empty", async () => {
    const { db, selectSpy } = createFakeDb([]);
    const repo = createCandidatesRepo(db);

    const result = await repo.findSince(new Date(), []);

    expect(result).toEqual([]);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("returns mapped rows when DB returns results", async () => {
    const rows = [
      baseRow({ id: 1, title: "First" }),
      baseRow({ id: 2, title: "Second", sourceType: "reddit" as SourceType }),
    ];
    const { db } = createFakeDb(rows);
    const repo = createCandidatesRepo(db);

    const result = await repo.findSince(new Date("2026-04-19T00:00:00Z"), ["hn", "reddit"]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("First");
    expect(result[1].title).toBe("Second");
  });

  it("passes since date and sourceTypes to the DB query via where clause", async () => {
    const { db, captured } = createFakeDb([baseRow()]);
    const repo = createCandidatesRepo(db);
    const since = new Date("2026-04-19T00:00:00Z");

    await repo.findSince(since, ["hn"]);

    expect(captured.fromCalled).toBe(true);
    expect(captured.whereArg).toBeDefined();
  });

  it("where clause references collected_at and source_type columns", async () => {
    const { db, captured } = createFakeDb([baseRow()]);
    const repo = createCandidatesRepo(db);

    await repo.findSince(new Date("2026-04-19T00:00:00Z"), ["hn"]);

    const referencedColumns = collectColumnNames(captured.whereArg);
    expect(referencedColumns).toContain("collected_at");
    expect(referencedColumns).toContain("source_type");
  });

  it("returns all fields of CandidateRow from DB rows", async () => {
    const row = baseRow({
      id: 42,
      title: "Full row",
      url: "https://example.com/full",
      sourceType: "reddit" as SourceType,
      author: "alice",
      publishedAt: new Date("2026-04-20T08:00:00Z"),
      engagement: { points: 100, commentCount: 50 },
      content: "article body",
    });
    const { db } = createFakeDb([row]);
    const repo = createCandidatesRepo(db);

    const result = await repo.findSince(new Date("2026-04-19T00:00:00Z"), ["reddit"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(row);
  });
});
