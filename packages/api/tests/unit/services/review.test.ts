import { describe, it, expect, vi } from "vitest";
import type { RankedItem, RankedItemRef, PoolResponse } from "@newsletter/shared";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  patchArchive,
  addPostToArchive,
  getPool,
  promoteItem,
  NotFoundError,
  ValidationError,
  ConflictError,
  type ReviewDeps,
  type PromoteDeps,
} from "@api/services/review.js";

function makeArchiveRepo(
  row: RunArchiveRow | null,
  updated?: RunArchiveRow,
  poolResult?: PoolResponse,
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() =>
      Promise.resolve(updated ?? (row as RunArchiveRow)),
    ),
    findPoolItems: vi.fn(() =>
      Promise.resolve(poolResult ?? { items: [], total: 0 }),
    ),
  };
}

function makeRawRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id))),
    ),
  };
}

const date = new Date("2026-04-10T00:00:00Z");

function makeArchiveRow(refs: RankedItemRef[], opts: { startedAt?: Date | null; sourceTypes?: string[] | null } = {}): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: refs,
    topN: 5,
    reviewed: false,
    completedAt: date,
    createdAt: date,
    startedAt: "startedAt" in opts ? (opts.startedAt ?? null) : null,
    sourceTypes: "sourceTypes" in opts ? (opts.sourceTypes as RunArchiveRow["sourceTypes"] ?? null) : null,
  };
}

describe("patchArchive (REQ-160, REQ-161, REQ-163)", () => {
  it("REQ-163: throws NotFoundError when archive missing", async () => {
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(null),
      rawItemsRepo: makeRawRepo([]),
    };
    await expect(
      patchArchive("missing", { rankedItems: [{ id: 1, sourceType: "hn" }] }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("REQ-161: throws ValidationError listing missing ids when raw_items are absent", async () => {
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(makeArchiveRow([])),
      rawItemsRepo: makeRawRepo([]),
    };
    try {
      await patchArchive(
        "run-1",
        {
          rankedItems: [
            { id: 1, sourceType: "hn" },
            { id: 2, sourceType: "reddit" },
          ],
        },
        deps,
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).missingIds).toEqual([1, 2]);
    }
  });

  it("REQ-160: writes via repo.updateRankedItems with the provided refs", async () => {
    const archiveRow = makeArchiveRow([]);
    const updated: RunArchiveRow = {
      ...archiveRow,
      rankedItems: [{ rawItemId: 1, score: 0, rationale: "" }],
      reviewed: true,
    };
    const archiveRepo = makeArchiveRepo(archiveRow, updated);
    const rawRow: RawItemRow = {
      id: 1,
      sourceType: "hn",
      title: "t",
      url: "https://x",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      imageUrl: null,
      metadata: { comments: [] },
    };
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([rawRow]),
    };
    const result = await patchArchive(
      "run-1",
      { rankedItems: [{ id: 1, sourceType: "hn" }] },
      deps,
    );
    expect(result.reviewed).toBe(true);
    expect(archiveRepo.updateRankedItems).toHaveBeenCalledWith(
      "run-1",
      [{ rawItemId: 1, score: 0, rationale: "" }],
      expect.objectContaining({
        rawItemsById: expect.any(Map),
        digestHeadline: "t",
        digestSummary: null,
      }),
    );
  });

  it("REQ-001/EDGE-001: derives digest fields from the new rank-one item when the original first item is removed", async () => {
    const archiveRow = makeArchiveRow(
      [
        { rawItemId: 1, score: 0.9, rationale: "old lead" },
        { rawItemId: 2, score: 0.8, rationale: "new lead" },
      ],
      {},
    );
    const archiveRepo = makeArchiveRepo(archiveRow);
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([
        {
          id: 2,
          sourceType: "hn",
          title: "Raw second title",
          url: "https://x/2",
          author: null,
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          content: null,
          imageUrl: null,
          metadata: {
            comments: [],
            recap: {
              title: "Second recap headline",
              summary: "Second recap summary",
              bullets: [],
              bottomLine: "",
            },
          },
        },
      ]),
    };

    await patchArchive(
      "run-1",
      { rankedItems: [{ id: 2, sourceType: "hn" }] },
      deps,
    );

    expect(archiveRepo.updateRankedItems).toHaveBeenCalledWith(
      "run-1",
      [{ rawItemId: 2, score: 0, rationale: "" }],
      expect.objectContaining({
        digestHeadline: "Second recap headline",
        digestSummary: "Second recap summary",
      }),
    );
  });

  it("REQ-003/EDGE-003: derives digest fields from inline rank-one edits before raw recap metadata", async () => {
    const archiveRow = makeArchiveRow([]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([
        {
          id: 3,
          sourceType: "hn",
          title: "Raw title",
          url: "https://x/3",
          author: null,
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          content: null,
          imageUrl: null,
          metadata: {
            comments: [],
            recap: {
              title: "Recap headline",
              summary: "Recap summary",
              bullets: [],
              bottomLine: "",
            },
          },
        },
      ]),
    };

    await patchArchive(
      "run-1",
      {
        rankedItems: [
          {
            id: 3,
            sourceType: "hn",
            title: "Operator headline",
            summary: "Operator summary",
          },
        ],
      },
      deps,
    );

    expect(archiveRepo.updateRankedItems).toHaveBeenCalledWith(
      "run-1",
      [
        {
          rawItemId: 3,
          score: 0,
          rationale: "",
          title: "Operator headline",
          summary: "Operator summary",
        },
      ],
      expect.objectContaining({
        digestHeadline: "Operator headline",
        digestSummary: "Operator summary",
      }),
    );
  });
});

describe("patchArchive — optional editable fields (REQ-004, REQ-005, EDGE-007)", () => {
  function makeRawRow(id: number): RawItemRow {
    return {
      id,
      sourceType: "hn",
      title: `t${id}`,
      url: `https://x/${id}`,
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      imageUrl: null,
      metadata: { comments: [] },
    };
  }

  it("passes summary, bullets, bottomLine, imageUrl through to RankedItemRef when present", async () => {
    const archiveRow = makeArchiveRow([]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([makeRawRow(1)]),
    };
    await patchArchive(
      "run-1",
      {
        rankedItems: [
          {
            id: 1,
            sourceType: "hn",
            summary: "my summary",
            bullets: ["point 1", "point 2"],
            bottomLine: "final thought",
            imageUrl: "https://img.example.com/pic.png",
          },
        ],
      },
      deps,
    );
    expect(archiveRepo.updateRankedItems).toHaveBeenCalledWith(
      "run-1",
      [
        {
          rawItemId: 1,
          score: 0,
          rationale: "",
          summary: "my summary",
          bullets: ["point 1", "point 2"],
          bottomLine: "final thought",
          imageUrl: "https://img.example.com/pic.png",
        },
      ],
      expect.objectContaining({ rawItemsById: expect.any(Map) }),
    );
  });

  it("passes title through to RankedItemRef when present", async () => {
    const archiveRow = makeArchiveRow([]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([makeRawRow(3)]),
    };
    await patchArchive(
      "run-1",
      {
        rankedItems: [
          { id: 3, sourceType: "hn", title: "Operator-edited title" },
        ],
      },
      deps,
    );
    const callArg = (archiveRepo.updateRankedItems as ReturnType<typeof vi.fn>).mock.calls[0][1] as RankedItemRef[];
    expect(callArg[0].title).toBe("Operator-edited title");
  });

  it("EDGE-007: does NOT add optional fields to RankedItemRef when absent from input (backward compat)", async () => {
    const archiveRow = makeArchiveRow([]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const deps: ReviewDeps = {
      archiveRepo,
      rawItemsRepo: makeRawRepo([makeRawRow(2)]),
    };
    await patchArchive(
      "run-1",
      { rankedItems: [{ id: 2, sourceType: "hn" }] },
      deps,
    );
    const callArg = (archiveRepo.updateRankedItems as ReturnType<typeof vi.fn>).mock.calls[0][1] as RankedItemRef[];
    expect(callArg[0]).not.toHaveProperty("title");
    expect(callArg[0]).not.toHaveProperty("summary");
    expect(callArg[0]).not.toHaveProperty("bullets");
    expect(callArg[0]).not.toHaveProperty("bottomLine");
    expect(callArg[0]).not.toHaveProperty("imageUrl");
  });
});

describe("addPostToArchive (REQ-140 – REQ-146)", () => {
  function makeRanked(): RankedItem {
    return {
      id: 99,
      rawItemId: 99,
      title: "Added Post",
      url: "https://example.com/new",
      sourceType: "web",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      score: 0,
      rationale: "Added manually during review",
      content: null,
      imageUrl: null,
      recap: null,
    };
  }

  it("REQ-163: throws NotFoundError when archive missing", async () => {
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(null),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: vi.fn(),
    };
    await expect(
      addPostToArchive("missing", { url: "https://x" }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("REQ-146: throws ConflictError when raw_items.url already in archive", async () => {
    const ranked = makeRanked();
    const existing: RawItemRow = {
      id: 99,
      sourceType: "web",
      title: "already in",
      url: ranked.url,
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      imageUrl: null,
      metadata: { comments: [] },
    };
    const archiveRow = makeArchiveRow([
      { rawItemId: 99, score: 0.5, rationale: "" },
    ]);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([existing]),
      hydrateAddedPost: vi.fn(),
    };
    await expect(
      addPostToArchive("run-1", { url: ranked.url }, deps),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("REQ-140: returns the hydrated RankedItem on happy path with a blog URL", async () => {
    const ranked = makeRanked();
    const archiveRow = makeArchiveRow([]);
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: hydrate,
    };
    const result = await addPostToArchive("run-1", { url: "https://example.com/blog" }, deps);
    expect(result).toEqual(ranked);
    expect(hydrate).toHaveBeenCalledOnce();
    // blog URL → detected as "web"
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("web");
  });

  // REQ-005: source type is detected from URL and passed to hydrateAddedPost
  it("REQ-005: passes sourceType 'hn' to hydrateAddedPost for HN URL", async () => {
    const ranked = makeRanked();
    const archiveRow = makeArchiveRow([]);
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: hydrate,
    };
    await addPostToArchive("run-1", { url: "https://news.ycombinator.com/item?id=12345" }, deps);
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("hn");
  });

  it("REQ-005: passes sourceType 'reddit' to hydrateAddedPost for Reddit URL", async () => {
    const ranked = makeRanked();
    const archiveRow = makeArchiveRow([]);
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: hydrate,
    };
    await addPostToArchive("run-1", { url: "https://www.reddit.com/r/test/comments/abc/foo/" }, deps);
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("reddit");
  });

  it("REQ-005: passes sourceType 'web' to hydrateAddedPost for arbitrary blog URL", async () => {
    const ranked = makeRanked();
    const archiveRow = makeArchiveRow([]);
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: hydrate,
    };
    await addPostToArchive("run-1", { url: "https://example.com/blog" }, deps);
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("web");
  });
});

describe("getPool (REQ-013, EDGE-006)", () => {
  const defaultQuery = { sort: "engagement" as const, offset: 0, limit: 20 };

  it("throws NotFoundError when archive not found (REQ-013)", async () => {
    const archiveRepo = makeArchiveRepo(null);
    await expect(
      getPool("missing-run", defaultQuery, { archiveRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("EDGE-006: returns empty pool when startedAt is null (legacy run)", async () => {
    const archive = makeArchiveRow([], { startedAt: null, sourceTypes: ["hn"] });
    const archiveRepo = makeArchiveRepo(archive);
    const result = await getPool("run-1", defaultQuery, { archiveRepo });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("EDGE-006: returns empty pool when sourceTypes is null (legacy run)", async () => {
    const archive = makeArchiveRow([], { startedAt: new Date(), sourceTypes: null });
    const archiveRepo = makeArchiveRepo(archive);
    const result = await getPool("run-1", defaultQuery, { archiveRepo });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("REQ-013: calls findPoolItems with rankedIds, startedAt, sourceTypes from archive", async () => {
    const startedAt = new Date("2026-04-10T00:00:00Z");
    const archive = makeArchiveRow(
      [{ rawItemId: 42, score: 0.9, rationale: "" }],
      { startedAt, sourceTypes: ["hn", "reddit"] },
    );
    const poolResult: PoolResponse = {
      items: [{ id: 1, title: "Test", url: "https://x.com", sourceType: "hn", author: null, publishedAt: null, engagement: { points: 10, commentCount: 2 }, imageUrl: null }],
      total: 1,
    };
    const archiveRepo = makeArchiveRepo(archive, undefined, poolResult);
    const result = await getPool("run-1", defaultQuery, { archiveRepo });
    expect(result).toEqual(poolResult);
    expect(archiveRepo.findPoolItems).toHaveBeenCalledWith("run-1", expect.objectContaining({
      rankedIds: [42],
      startedAt,
      sourceTypes: ["hn", "reddit"],
      sort: "engagement",
      offset: 0,
      limit: 20,
    }));
  });
});

describe("promoteItem (REQ-010, REQ-011, EDGE-007)", () => {
  function makeRawRow(id: number): RawItemRow {
    return {
      id,
      sourceType: "hn",
      title: "Test Item",
      url: "https://example.com/item",
      author: null,
      publishedAt: null,
      engagement: { points: 5, commentCount: 1 },
      content: null,
      imageUrl: null,
      metadata: { comments: [] },
    };
  }

  it("REQ-011: throws NotFoundError when archive not found", async () => {
    const deps: PromoteDeps = {
      archiveRepo: makeArchiveRepo(null),
      rawItemsRepo: makeRawRepo([]),
      generateRecapFn: vi.fn(),
    };
    await expect(
      promoteItem("missing", { rawItemId: 1 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("REQ-011: throws NotFoundError when rawItemId not in raw_items", async () => {
    const archive = makeArchiveRow([], { startedAt: new Date(), sourceTypes: ["hn"] });
    const deps: PromoteDeps = {
      archiveRepo: makeArchiveRepo(archive),
      rawItemsRepo: makeRawRepo([]),
      generateRecapFn: vi.fn(),
    };
    await expect(
      promoteItem("run-1", { rawItemId: 999 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("REQ-011/EDGE-007: throws ConflictError when rawItemId already in archive.rankedItems", async () => {
    const archive = makeArchiveRow(
      [{ rawItemId: 10, score: 0.9, rationale: "" }],
      { startedAt: new Date(), sourceTypes: ["hn"] },
    );
    const deps: PromoteDeps = {
      archiveRepo: makeArchiveRepo(archive),
      rawItemsRepo: makeRawRepo([makeRawRow(10)]),
      generateRecapFn: vi.fn(),
    };
    await expect(
      promoteItem("run-1", { rawItemId: 10 }, deps),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("REQ-011/EDGE-007: ConflictError message is 'Item is already in the ranked list'", async () => {
    const archive = makeArchiveRow(
      [{ rawItemId: 10, score: 0.9, rationale: "" }],
      { startedAt: new Date(), sourceTypes: ["hn"] },
    );
    const deps: PromoteDeps = {
      archiveRepo: makeArchiveRepo(archive),
      rawItemsRepo: makeRawRepo([makeRawRow(10)]),
      generateRecapFn: vi.fn(),
    };
    await expect(
      promoteItem("run-1", { rawItemId: 10 }, deps),
    ).rejects.toThrow("Item is already in the ranked list");
  });

  it("REQ-010: returns RankedItem with recap when item exists and not yet ranked", async () => {
    const archive = makeArchiveRow([], { startedAt: new Date(), sourceTypes: ["hn"] });
    const rawRow = makeRawRow(10);
    const recap = { title: "Recap title", summary: "A summary", bullets: ["b1", "b2", "b3"], bottomLine: "The bottom line" };
    const generateRecapFn = vi.fn().mockResolvedValue(recap);
    const deps: PromoteDeps = {
      archiveRepo: makeArchiveRepo(archive),
      rawItemsRepo: makeRawRepo([rawRow]),
      generateRecapFn,
    };
    const result = await promoteItem("run-1", { rawItemId: 10 }, deps);
    expect(result.id).toBe(10);
    expect(result.rawItemId).toBe(10);
    // AI-generated recap title takes precedence over source title
    expect(result.title).toBe(recap.title);
    expect(result.url).toBe(rawRow.url);
    expect(result.score).toBe(0);
    expect(result.rationale).toBe("");
    expect(result.recap).toEqual(recap);
    expect(generateRecapFn).toHaveBeenCalledOnce();
  });
});
