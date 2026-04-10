import { describe, it, expect, vi } from "vitest";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader";
import type { CandidatesRepo, CandidateRow } from "@pipeline/repositories/candidates.js";
import type { RawItemComment, RawItemMetadata } from "@newsletter/shared";

const SAMPLE_COMMENT: RawItemComment = {
  id: "c1",
  author: "alice",
  content: "insightful take",
  publishedAt: "2026-04-01T00:00:00Z",
};

function baseRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
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

function makeRepo(rows: CandidateRow[]): CandidatesRepo {
  return {
    findSince: vi.fn().mockResolvedValue(rows),
  };
}

describe("loadCandidatesSince", () => {
  it("REQ-010: maps non-null content through to candidate.content", async () => {
    const repo = makeRepo([baseRow({ content: "article body markdown" })]);

    const result = await loadCandidatesSince(
      repo,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("article body markdown");
  });

  it("REQ-011: preserves null content and types comments as RawItemComment[]", async () => {
    const repo = makeRepo([
      baseRow({
        content: null,
        metadata: { comments: [SAMPLE_COMMENT] } as RawItemMetadata,
      }),
    ]);

    const result = await loadCandidatesSince(
      repo,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result[0].content).toBeNull();
    const comments: RawItemComment[] = result[0].comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual(SAMPLE_COMMENT);
  });

  it("REQ-012: row with metadata.comments === [] yields empty comments array", async () => {
    const repo = makeRepo([baseRow({ metadata: { comments: [] } })]);

    const result = await loadCandidatesSince(
      repo,
      new Date("2026-04-01T00:00:00Z"),
      ["hn"],
    );

    expect(result[0].comments).toEqual([]);
    expect(result[0].comments.length).toBe(0);
  });

  it("delegates to repo.findSince with correct since and sourceTypes", async () => {
    const repo = makeRepo([baseRow()]);
    const since = new Date("2026-04-01T00:00:00Z");

    await loadCandidatesSince(repo, since, ["hn"]);

    expect(repo.findSince).toHaveBeenCalledWith(since, ["hn"]);
  });

  it("short-circuits to empty array when sourceTypes is empty", async () => {
    const repo = makeRepo([baseRow()]);

    const result = await loadCandidatesSince(
      repo,
      new Date("2026-04-01T00:00:00Z"),
      [],
    );

    expect(result).toEqual([]);
  });

  it("maps multiple rows preserving all shared Candidate fields", async () => {
    const repo = makeRepo([
      baseRow({
        id: 1,
        title: "First",
        content: "body 1",
        metadata: { comments: [SAMPLE_COMMENT] } as RawItemMetadata,
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
      repo,
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
