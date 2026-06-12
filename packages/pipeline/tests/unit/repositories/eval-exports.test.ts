import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { describe, expect, it } from "vitest";

import {
  completedRunsDateWindow,
  createEvalExportsRepo,
} from "@pipeline/repositories/eval-exports.js";
import type { RawItemRow } from "@pipeline/repositories/raw-items.js";

describe("completedRunsDateWindow", () => {
  it("accepts legacy IANA timezone aliases supported by Intl", () => {
    const window = completedRunsDateWindow("2026-05-23", "Asia/Calcutta");

    expect(window).not.toBeNull();
    expect(window?.from.toISOString()).toBe("2026-05-22T18:30:00.000Z");
    expect(window?.to.toISOString()).toBe("2026-05-23T18:29:59.999Z");
  });

  it("returns null for invalid date input", () => {
    expect(completedRunsDateWindow("23/05/2026", "UTC")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawItemRow(overrides: Partial<RawItemRow> & { id: number; url: string }): RawItemRow {
  return {
    sourceType: "hn",
    externalId: `ext-${String(overrides.id)}`,
    title: `Title ${String(overrides.id)}`,
    sourceUrl: null,
    author: null,
    content: null,
    imageUrl: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    ...overrides,
  };
}

/**
 * Minimal fake DB that:
 * - For the first `.select()` call (run_archives query), returns `archiveRows`.
 * - For subsequent `.select()` calls, dispatches based on call order:
 *   - 2nd call = byRunId query.
 *   - 3rd call (only if 2nd returned empty) = window fallback query.
 *
 * This is enough to unit-test the new loadDedupedPool logic without a real DB.
 */
function makeFakeDb(opts: {
  archiveRows: unknown[];
  rawByRunId: RawItemRow[];
  rawWindow: RawItemRow[];
}) {
  let selectCallCount = 0;

  const makeRawChain = (rows: RawItemRow[]) => ({
    from: () => ({
      where: (_condition: unknown) => Promise.resolve(rows),
    }),
  });

  const makeArchiveChain = () => ({
    from: () => ({
      where: () => Promise.resolve(opts.archiveRows),
    }),
  });

  return {
    select: (_cols?: unknown) => {
      const callIndex = selectCallCount++;
      if (callIndex === 0) {
        // First select = run_archives query
        return makeArchiveChain();
      }
      if (callIndex === 1) {
        // Second select = byRunId query
        return makeRawChain(opts.rawByRunId);
      }
      // Third select = window fallback (only reached when byRunId is empty)
      return makeRawChain(opts.rawWindow);
    },
  } as unknown as Parameters<typeof createEvalExportsRepo>[0];
}

const BASE_ARCHIVE = {
  id: "run-001",
  rankedItems: [
    {
      rawItemId: 1,
      score: 0.9,
      rationale: "top",
      title: "Ranked Title 1",
      summary: "s",
      bullets: [],
      bottomLine: "",
    },
  ],
  createdAt: new Date("2026-05-22T08:00:00Z"),
  completedAt: new Date("2026-05-22T09:00:00Z"),
  startedAt: new Date("2026-05-22T08:00:00Z"),
  topN: 10,
  digestHeadline: "Test headline",
  digestSummary: "Test summary",
  sourceTypes: ["hn"],
};

// ---------------------------------------------------------------------------
// VS-1 (REQ-006): dedup removes URL-duplicate from pool
// ---------------------------------------------------------------------------
describe("VS-1: getCompletedRunDetail deduplicates URL duplicates in sourcePool", () => {
  it("VS-1: only higher-engagement survivor is in sourcePool when two items share a canonical URL", async () => {
    // Two items: same canonical URL (utm_source stripped), different engagement. Item 2 wins.
    const rawByRunId: RawItemRow[] = [
      makeRawItemRow({
        id: 1,
        url: "https://example.com/article?utm_source=hn",
        engagement: { points: 5, commentCount: 1 },
      }),
      makeRawItemRow({
        id: 2,
        url: "https://example.com/article",
        engagement: { points: 20, commentCount: 3 },
      }),
    ];

    const db = makeFakeDb({
      archiveRows: [BASE_ARCHIVE],
      rawByRunId,
      rawWindow: [],
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("run-001");

    if (detail === null) throw new Error("expected detail to be non-null");
    // After dedup, only 1 item should remain (the higher-engagement winner)
    expect(detail.sourcePool).toHaveLength(1);
    expect(detail.itemCount).toBe(1);
    // The winner is item 2 (higher engagement)
    expect(detail.sourcePool[0].rawItemId).toBe(2);
  });

  it("VS-1: candidate list in previousRanking excludes the deduplicated item", async () => {
    // Ranked items: item 1 and item 2 (both ranked)
    const archive = {
      ...BASE_ARCHIVE,
      rankedItems: [
        { rawItemId: 1, score: 0.9, rationale: "r1", title: "T1", summary: "", bullets: [], bottomLine: "" },
        { rawItemId: 2, score: 0.8, rationale: "r2", title: "T2", summary: "", bullets: [], bottomLine: "" },
      ],
    };
    const rawByRunId: RawItemRow[] = [
      makeRawItemRow({
        id: 1,
        url: "https://example.com/article?utm_source=hn",
        engagement: { points: 5, commentCount: 1 },
      }),
      makeRawItemRow({
        id: 2,
        url: "https://example.com/article",
        engagement: { points: 20, commentCount: 3 },
      }),
    ];

    const db = makeFakeDb({
      archiveRows: [archive],
      rawByRunId,
      rawWindow: [],
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("run-001");

    if (detail === null) throw new Error("expected detail to be non-null");
    expect(detail.sourcePool).toHaveLength(1);
    // Item 1 was deduped out — it should not appear in sourcePool
    expect(detail.sourcePool.find((f) => f.rawItemId === 1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// VS-2 (REQ-004/005): run_id load + window fallback
// ---------------------------------------------------------------------------
describe("VS-2: getCompletedRunDetail loads by run_id and falls back to window", () => {
  it("VS-2a: loads items by run_id when rawByRunId is non-empty", async () => {
    const rawByRunId: RawItemRow[] = [
      makeRawItemRow({ id: 10, url: "https://example.com/a" }),
      makeRawItemRow({ id: 11, url: "https://example.com/b" }),
    ];
    const rawWindow: RawItemRow[] = [
      makeRawItemRow({ id: 99, url: "https://example.com/window-only" }),
    ];

    const db = makeFakeDb({
      archiveRows: [BASE_ARCHIVE],
      rawByRunId,
      rawWindow,
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("run-001");

    if (detail === null) throw new Error("expected detail to be non-null");
    // Should use run_id items (2 unique URLs, no dedup needed)
    expect(detail.sourcePool).toHaveLength(2);
    expect(detail.sourcePool.map((f) => f.rawItemId)).toEqual(
      expect.arrayContaining([10, 11]),
    );
    // Window-only item must not appear
    expect(detail.sourcePool.find((f) => f.rawItemId === 99)).toBeUndefined();
  });

  it("VS-2b: falls back to window when rawByRunId is empty (legacy archive)", async () => {
    const rawWindow: RawItemRow[] = [
      makeRawItemRow({ id: 50, url: "https://example.com/legacy-a" }),
      makeRawItemRow({ id: 51, url: "https://example.com/legacy-b" }),
    ];

    const db = makeFakeDb({
      archiveRows: [BASE_ARCHIVE],
      rawByRunId: [],   // no items tagged with this run_id
      rawWindow,
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("run-001");

    if (detail === null) throw new Error("expected detail to be non-null");
    // Should fall back to window items (deduped, 2 unique)
    expect(detail.sourcePool).toHaveLength(2);
    expect(detail.sourcePool.map((f) => f.rawItemId)).toEqual(
      expect.arrayContaining([50, 51]),
    );
  });

  it("VS-2c: returns null when archive not found", async () => {
    const db = makeFakeDb({
      archiveRows: [],
      rawByRunId: [],
      rawWindow: [],
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("nonexistent");
    expect(detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VS-3 (REQ-009): listCompletedRunsByDate.itemCount == getCompletedRunDetail.itemCount
// ---------------------------------------------------------------------------

/**
 * A variant of makeFakeDb for listCompletedRunsByDate:
 * - First select = run_archives list query (returns array of runs with .orderBy).
 * - Subsequent selects = per-run raw_items by run_id queries.
 */
function makeFakeDbForList(opts: {
  archiveRows: unknown[];
  rawByRunId: RawItemRow[];
  rawWindow: RawItemRow[];
}) {
  let selectCallCount = 0;

  // The list query returns rows, but each row needs .orderBy
  const makeArchiveListChain = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(opts.archiveRows),
      }),
    }),
  });

  const makeRawChain = (rows: RawItemRow[]) => ({
    from: () => ({
      where: (_condition: unknown) => Promise.resolve(rows),
    }),
  });

  return {
    select: (_cols?: unknown) => {
      const callIndex = selectCallCount++;
      if (callIndex === 0) {
        return makeArchiveListChain();
      }
      // For each run in the list: 1 byRunId select (index 1), then possibly 1 window select (index 2)
      if (opts.rawByRunId.length > 0) {
        return makeRawChain(opts.rawByRunId);
      }
      // byRunId is empty — alternate: odd indexes = byRunId (empty), even = window
      const isRunIdCall = callIndex % 2 === 1;
      return makeRawChain(isRunIdCall ? opts.rawByRunId : opts.rawWindow);
    },
  } as unknown as Parameters<typeof createEvalExportsRepo>[0];
}

describe("VS-3 (REQ-009): listCompletedRunsByDate itemCount == getCompletedRunDetail itemCount", () => {
  it("VS-3: list itemCount equals detail itemCount (both = deduped pool size)", async () => {
    const rawByRunId: RawItemRow[] = [
      makeRawItemRow({ id: 10, url: "https://example.com/a", engagement: { points: 5, commentCount: 0 } }),
      makeRawItemRow({ id: 11, url: "https://example.com/b", engagement: { points: 3, commentCount: 0 } }),
      // Duplicate of item 10 (same canonical URL after utm stripping, lower engagement) — will be deduped
      makeRawItemRow({ id: 12, url: "https://example.com/a?utm_source=x", engagement: { points: 1, commentCount: 0 } }),
    ];
    // After dedup: 2 items survive (10 and 11)

    const listArchiveRow = {
      id: "run-001",
      rankedItems: [{ rawItemId: 10, score: 0.9, rationale: "r", title: "T" }],
      topN: 10,
      completedAt: new Date("2026-05-22T09:00:00Z"),
      createdAt: new Date("2026-05-22T08:00:00Z"),
      startedAt: new Date("2026-05-22T08:00:00Z"),
      digestHeadline: "headline",
      digestSummary: "summary",
      sourceTypes: ["hn"],
    };

    const dbForList = makeFakeDbForList({
      archiveRows: [listArchiveRow],
      rawByRunId,
      rawWindow: [],
    });

    const dbForDetail = makeFakeDb({
      archiveRows: [{ ...BASE_ARCHIVE, rankedItems: listArchiveRow.rankedItems }],
      rawByRunId,
      rawWindow: [],
    });

    const repoForList = createEvalExportsRepo(dbForList, TENANT_ZERO_ID);
    const repoForDetail = createEvalExportsRepo(dbForDetail, TENANT_ZERO_ID);

    const summaries = await repoForList.listCompletedRunsByDate("2026-05-22", "UTC");
    const detail = await repoForDetail.getCompletedRunDetail("run-001");

    expect(summaries).toHaveLength(1);
    if (detail === null) throw new Error("expected detail to be non-null");

    // Both should report 2 (the deduped pool size, not the rankedItems count of 1)
    expect(summaries[0].itemCount).toBe(2);
    expect(detail.itemCount).toBe(2);
    expect(summaries[0].itemCount).toBe(detail.itemCount);
  });
});

// ---------------------------------------------------------------------------
// REQ-008 / EDGE-005: previousRanking id absent from deduped pool still renders
// ---------------------------------------------------------------------------
describe("REQ-008/EDGE-005: previousRanking renders even when id absent from deduped pool", () => {
  it("renders previousRanking item from RankedItemRef even when it is not in the deduped sourcePool", async () => {
    // Pool has item 2 only (item 1 was deduplicated away or not collected this run)
    const rawByRunId: RawItemRow[] = [
      makeRawItemRow({ id: 2, url: "https://example.com/b", engagement: { points: 10, commentCount: 0 } }),
    ];

    // But the archive's rankedItems references item 1 (which is now absent from pool)
    const archiveWithAbsentRankedId = {
      ...BASE_ARCHIVE,
      rankedItems: [
        {
          rawItemId: 1,
          score: 0.95,
          rationale: "was great",
          title: "Absent Item Title",
          summary: "Absent summary",
          bullets: ["bullet1"],
          bottomLine: "absent bottom line",
        },
      ],
    };

    const db = makeFakeDb({
      archiveRows: [archiveWithAbsentRankedId],
      rawByRunId,
      rawWindow: [],
    });

    const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);
    const detail = await repo.getCompletedRunDetail("run-001");

    if (detail === null) throw new Error("expected detail to be non-null");
    // sourcePool only has item 2
    expect(detail.sourcePool).toHaveLength(1);
    expect(detail.sourcePool[0].rawItemId).toBe(2);

    // previousRanking still has item 1 rendered from RankedItemRef
    expect(detail.previousRanking).toHaveLength(1);
    const prevItem = detail.previousRanking[0];
    expect(prevItem.rawItemId).toBe(1);
    // Title comes from RankedItemRef.title since item is absent from pool
    expect(prevItem.title).toBe("Absent Item Title");
    // url and sourceType gracefully fall back to empty string (item not in pool)
    expect(prevItem.url).toBe("");
    expect(prevItem.sourceType).toBe("");
    expect(prevItem.score).toBe(0.95);
  });
});
