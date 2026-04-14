import { describe, it, expect, vi } from "vitest";
import type { RankedItem, RankedItemRef } from "@newsletter/shared";
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
  NotFoundError,
  ValidationError,
  ConflictError,
  type ReviewDeps,
} from "@api/services/review.js";

function makeArchiveRepo(
  row: RunArchiveRow | null,
  updated?: RunArchiveRow,
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() =>
      Promise.resolve(updated ?? (row as RunArchiveRow)),
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

function makeArchiveRow(refs: RankedItemRef[]): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: refs,
    topN: 5,
    profileName: null,
    reviewed: false,
    completedAt: date,
    createdAt: date,
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
    );
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
      addPostToArchive("missing", { sourceType: "web", url: "https://x" }, deps),
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
      addPostToArchive(
        "run-1",
        { sourceType: "web", url: ranked.url },
        deps,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("REQ-140: returns the hydrated RankedItem on happy path", async () => {
    const ranked = makeRanked();
    const archiveRow = makeArchiveRow([]);
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const deps: ReviewDeps = {
      archiveRepo: makeArchiveRepo(archiveRow),
      rawItemsRepo: makeRawRepo([]),
      hydrateAddedPost: hydrate,
    };
    const result = await addPostToArchive(
      "run-1",
      { sourceType: "web", url: ranked.url },
      deps,
    );
    expect(result).toEqual(ranked);
    expect(hydrate).toHaveBeenCalledOnce();
  });
});
