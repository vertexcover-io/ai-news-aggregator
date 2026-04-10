import { describe, it, expect, vi } from "vitest";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader";
import type { AppDb } from "@newsletter/shared/db";
import type { RawItemComment, RawItemMetadata } from "@newsletter/shared";

interface FakeRow {
  id: number;
  title: string;
  url: string;
  sourceType: "hn" | "reddit" | "twitter" | "rss" | "github" | "blog" | "newsletter";
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  metadata: RawItemMetadata;
}

interface CapturedSelect {
  columns: Record<string, unknown> | null;
}

function createFakeDb(rows: FakeRow[]): {
  db: Pick<AppDb, "select">;
  captured: CapturedSelect;
} {
  const captured: CapturedSelect = { columns: null };

  const whereThenable = {
    then: (resolve: (value: FakeRow[]) => unknown): Promise<unknown> =>
      Promise.resolve(rows).then(resolve),
  };

  const fromBuilder = {
    where: (): typeof whereThenable => whereThenable,
  };

  const selectBuilder = {
    from: (): typeof fromBuilder => fromBuilder,
  };

  const selectSpy = vi.fn((cols: Record<string, unknown>) => {
    captured.columns = cols;
    return selectBuilder;
  });

  const db = {
    select: selectSpy,
  } as unknown as Pick<AppDb, "select">;

  return { db, captured };
}

const SAMPLE_COMMENT: RawItemComment = {
  id: "c1",
  author: "alice",
  content: "insightful take",
  publishedAt: "2026-04-01T00:00:00Z",
};

function baseRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 1,
    title: "Example",
    url: "https://example.com",
    sourceType: "hn",
    author: "bob",
    publishedAt: new Date("2026-04-01T00:00:00Z"),
    engagement: { points: 10, commentCount: 2 },
    content: null,
    metadata: { comments: [] },
    ...overrides,
  };
}

describe("loadCandidatesSince", () => {
  it("REQ-010: maps non-null content through to candidate.content", async () => {
    const { db } = createFakeDb([
      baseRow({ content: "article body markdown" }),
    ]);

    const result = await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("article body markdown");
  });

  it("REQ-011: preserves null content and types comments as RawItemComment[]", async () => {
    const { db } = createFakeDb([
      baseRow({
        content: null,
        metadata: { comments: [SAMPLE_COMMENT] },
      }),
    ]);

    const result = await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result[0].content).toBeNull();
    const comments: RawItemComment[] = result[0].comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual(SAMPLE_COMMENT);
  });

  it("REQ-012: row with metadata.comments === [] yields empty comments array", async () => {
    const { db } = createFakeDb([
      baseRow({ metadata: { comments: [] } }),
    ]);

    const result = await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result[0].comments).toEqual([]);
    expect(result[0].comments.length).toBe(0);
  });

  it("selects content and metadata columns in the db.select projection", async () => {
    const { db, captured } = createFakeDb([baseRow()]);

    await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(captured.columns).not.toBeNull();
    if (captured.columns === null) throw new Error("expected select columns");
    expect(Object.keys(captured.columns)).toContain("content");
    expect(Object.keys(captured.columns)).toContain("metadata");
  });

  it("short-circuits to empty array when sourceTypes is empty", async () => {
    const { db, captured } = createFakeDb([baseRow()]);

    const result = await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      [],
    );

    expect(result).toEqual([]);
    expect(captured.columns).toBeNull();
  });

  it("maps multiple rows preserving all shared Candidate fields", async () => {
    const { db } = createFakeDb([
      baseRow({
        id: 1,
        title: "First",
        content: "body 1",
        metadata: { comments: [SAMPLE_COMMENT] },
      }),
      baseRow({
        id: 2,
        title: "Second",
        sourceType: "reddit",
        author: null,
        publishedAt: null,
        content: null,
        metadata: { comments: [] },
      }),
    ]);

    const result = await loadCandidatesSince(
      db as AppDb,
      new Date("2026-04-01T00:00:00Z"),
      ["hn", "reddit"],
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 1,
      title: "First",
      url: "https://example.com",
      sourceType: "hn",
      author: "bob",
      publishedAt: new Date("2026-04-01T00:00:00Z"),
      engagement: { points: 10, commentCount: 2 },
      content: "body 1",
      comments: [SAMPLE_COMMENT],
    });
    expect(result[1].sourceType).toBe("reddit");
    expect(result[1].author).toBeNull();
    expect(result[1].publishedAt).toBeNull();
    expect(result[1].content).toBeNull();
    expect(result[1].comments).toEqual([]);
  });
});
