import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef, SourceType } from "@newsletter/shared";
import type { RawItemRow, RawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";

interface StoredArchive {
  id: string;
  status: "completed" | "failed";
  rankedItems: RankedItemRef[];
  topN: number;
  reviewed: boolean;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  sourceTypes: SourceType[] | null;
}

function makeFakeDb(initial: StoredArchive): {
  db: Pick<AppDb, "select" | "update">;
  store: { row: StoredArchive };
} {
  const store = { row: { ...initial } };
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([store.row]),
        orderBy: () => ({
          limit: () => Promise.resolve([store.row]),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<StoredArchive>) => ({
        where: () => ({
          returning: () => {
            store.row = { ...store.row, ...patch };
            return Promise.resolve([store.row]);
          },
        }),
      }),
    }),
  } as unknown as Pick<AppDb, "select" | "update">;
  return { db, store };
}

function makeDefaultArchive(overrides: Partial<StoredArchive> = {}): StoredArchive {
  const completedAt = new Date("2026-04-10T00:00:00Z");
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "completed",
    rankedItems: [],
    topN: 5,
    reviewed: false,
    completedAt,
    createdAt: completedAt,
    updatedAt: completedAt,
    startedAt: null,
    sourceTypes: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers for hydration tests
// ---------------------------------------------------------------------------

const defaultRaw: RawItemRow = {
  id: 1,
  sourceType: "hn",
  title: "Default Title",
  url: "https://example.com",
  author: null,
  publishedAt: null,
  engagement: { points: 0, commentCount: 0 },
  content: null,
  imageUrl: null,
  metadata: { comments: [] },
};

function makeFakeRawItemsRepo(rows: Partial<RawItemRow>[]): { repo: RawItemsRepo; spy: Mock } {
  const spy = vi.fn((ids: number[]) => {
    const result = rows
      .filter((r) => r.id !== undefined && ids.includes(r.id))
      .map((r) => ({ ...defaultRaw, ...r }));
    return Promise.resolve(result);
  });
  return { repo: { findByIds: spy }, spy };
}

/** Build a fake db that returns the given rows for listReviewed (reviewed = true) */
function makeFakeDbReviewed(rows: StoredArchive[]): Pick<AppDb, "select" | "update"> {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows.filter((r) => r.reviewed)),
        }),
        orderBy: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<StoredArchive>) => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...rows[0], ...patch }]),
        }),
      }),
    }),
  } as unknown as Pick<AppDb, "select" | "update">;
}

describe("RunArchivesRepo.findById — startedAt and sourceTypes (REQ-012, EDGE-006)", () => {
  it("returns startedAt: null and sourceTypes: null for a legacy row without those fields", async () => {
    const { db } = makeFakeDb(makeDefaultArchive({ id: "11111111-1111-1111-1111-111111111111", startedAt: null, sourceTypes: null }));
    const repo = createRunArchivesRepo(db);
    const row = await repo.findById("11111111-1111-1111-1111-111111111111");
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.startedAt).toBeNull();
    expect(row.sourceTypes).toBeNull();
  });

  it("returns correct Date for startedAt when present", async () => {
    const startedAt = new Date("2026-04-10T08:00:00Z");
    const { db } = makeFakeDb(makeDefaultArchive({ id: "22222222-2222-2222-2222-222222222222", startedAt, sourceTypes: ["hn", "reddit"] }));
    const repo = createRunArchivesRepo(db);
    const row = await repo.findById("22222222-2222-2222-2222-222222222222");
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.startedAt).toEqual(startedAt);
    expect(row.sourceTypes).toEqual(["hn", "reddit"]);
  });
});

describe("RunArchivesRepo.list — startedAt and sourceTypes (REQ-012)", () => {
  it("includes startedAt and sourceTypes in each listed row", async () => {
    const startedAt = new Date("2026-04-10T07:00:00Z");
    const { db } = makeFakeDb(makeDefaultArchive({ startedAt, sourceTypes: ["hn"] }));
    const repo = createRunArchivesRepo(db);
    const rows = await repo.list(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toEqual(startedAt);
    expect(rows[0].sourceTypes).toEqual(["hn"]);
  });
});

describe("RunArchivesRepo.updateRankedItems (REQ-160)", () => {
  it("overwrites rankedItems, sets reviewed=true, bumps updatedAt", async () => {
    const before = new Date("2026-04-10T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(before);
    const { db, store } = makeFakeDb({
      id: "run-1",
      status: "completed",
      rankedItems: [{ rawItemId: 1, score: 0.5, rationale: "old" }],
      topN: 5,
      reviewed: false,
      completedAt: before,
      createdAt: before,
      updatedAt: before,
      startedAt: null,
      sourceTypes: null,
    });
    const repo = createRunArchivesRepo(db);

    const newItems: RankedItemRef[] = [
      { rawItemId: 7, score: 0.9, rationale: "new top" },
      { rawItemId: 1, score: 0.5, rationale: "old kept" },
    ];

    vi.advanceTimersByTime(1000);
    const expectedUpdatedAt = new Date(before.getTime() + 1000);
    const updated = await repo.updateRankedItems("run-1", newItems);

    expect(updated.rankedItems).toEqual(newItems);
    expect(updated.reviewed).toBe(true);
    expect(store.row.rankedItems).toEqual(newItems);
    expect(store.row.reviewed).toBe(true);
    expect(store.row.updatedAt.getTime()).toBe(expectedUpdatedAt.getTime());
  });
});

// ---------------------------------------------------------------------------
// Phase 2: hydration tests
// ---------------------------------------------------------------------------

describe("RunArchivesRepo.listReviewed — hydration", () => {
  // 1. REQ-003 / REQ-004: topItems is first 3 in rank order
  it("returns topItems of length 3 in rank order when 4+ rankedItems exist (REQ-003, REQ-004)", async () => {
    const completedAt = new Date("2026-04-10T00:00:00Z");
    const archive = makeDefaultArchive({
      reviewed: true,
      completedAt,
      rankedItems: [
        { rawItemId: 10, score: 0.9, rationale: "a" },
        { rawItemId: 20, score: 0.8, rationale: "b" },
        { rawItemId: 30, score: 0.7, rationale: "c" },
        { rawItemId: 40, score: 0.6, rationale: "d" },
      ],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 10, title: "A", sourceType: "hn" },
      { id: 20, title: "B", sourceType: "reddit" },
      { id: 30, title: "C", sourceType: "hn" },
      { id: 40, title: "D", sourceType: "reddit" },
    ];
    const { repo, spy } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result).toHaveLength(1);
    expect(result[0].topItems).toHaveLength(3);
    expect(result[0].topItems[0]).toMatchObject({ id: 10, title: "A", sourceType: "hn" });
    expect(result[0].topItems[1]).toMatchObject({ id: 20, title: "B", sourceType: "reddit" });
    expect(result[0].topItems[2]).toMatchObject({ id: 30, title: "C", sourceType: "hn" });
    expect(spy).toHaveBeenCalledOnce();
  });

  // 2. REQ-005 / EDGE-007: missing raw row is skipped
  it("skips missing raw rows and returns shorter topItems (REQ-005, EDGE-007)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [
        { rawItemId: 7, score: 0.9, rationale: "x" },
        { rawItemId: 99, score: 0.8, rationale: "missing" },
        { rawItemId: 3, score: 0.7, rationale: "y" },
      ],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn" },
      { id: 3, title: "Three", sourceType: "reddit" },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].topItems).toHaveLength(2);
    expect(result[0].topItems[0].id).toBe(7);
    expect(result[0].topItems[1].id).toBe(3);
  });

  // 3. REQ-006: override summary takes precedence over raw recap
  it("uses override summary from rankedItems ref when present (REQ-006)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x", summary: "override" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { summary: "raw", bullets: [], bottomLine: "" } } },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].leadSummary).toBe("override");
  });

  // 4. REQ-006 fallback: no override, raw recap summary used
  it("falls back to raw recap summary when no override (REQ-006)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { summary: "raw summary", bullets: [], bottomLine: "" } } },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].leadSummary).toBe("raw summary");
  });

  // 5. REQ-007 (empty): empty rankedItems → storyCount=0, topItems=[], leadSummary=null
  it("returns storyCount=0, topItems=[], leadSummary=null for empty rankedItems (REQ-007)", async () => {
    const archive = makeDefaultArchive({ reviewed: true, rankedItems: [] });
    const db = makeFakeDbReviewed([archive]);
    const { repo } = makeFakeRawItemsRepo([]);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].storyCount).toBe(0);
    expect(result[0].topItems).toEqual([]);
    expect(result[0].leadSummary).toBeNull();
  });

  // 6. REQ-007 (no summary): no recap on raw row → leadSummary=null
  it("returns leadSummary=null when raw row has no recap (REQ-007)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [] } },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].leadSummary).toBeNull();
  });

  // 7. EDGE-005: explicit empty-string override summary yields leadSummary=""
  it("preserves empty-string override as leadSummary='' (EDGE-005)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x", summary: "" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { summary: "raw", bullets: [], bottomLine: "" } } },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].leadSummary).toBe("");
  });

  // 8. EDGE-006: raw recap is null → leadSummary=null (equivalent to case 6)
  it("returns leadSummary=null when raw recap is undefined (EDGE-006)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: undefined } },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].leadSummary).toBeNull();
  });

  // 9. REQ-008: single batch findByIds call for multiple rows
  it("calls findByIds exactly once for multiple rows with distinct ids (REQ-008)", async () => {
    const completedAt = new Date("2026-04-10T00:00:00Z");
    const archives = Array.from({ length: 5 }, (_, i) =>
      makeDefaultArchive({
        id: `0000000${i}-0000-0000-0000-000000000001`,
        reviewed: true,
        completedAt: new Date(completedAt.getTime() - i * 1000),
        rankedItems: [
          { rawItemId: i * 3 + 1, score: 0.9, rationale: "a" },
          { rawItemId: i * 3 + 2, score: 0.8, rationale: "b" },
          { rawItemId: i * 3 + 3, score: 0.7, rationale: "c" },
        ],
      })
    );
    const db = makeFakeDbReviewed(archives);
    const allIds = archives.flatMap((a) => a.rankedItems.map((r) => r.rawItemId));
    const rawRows: Partial<RawItemRow>[] = allIds.map((id) => ({
      id,
      title: `Item ${id}`,
      sourceType: "hn" as SourceType,
    }));
    const { repo, spy } = makeFakeRawItemsRepo(rawRows);
    await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][0]).toHaveLength(15);
  });

  // 10. REQ-008 (dedup): shared ids across rows appear once in findByIds call
  it("deduplicates rawItemIds across rows in the single findByIds call (REQ-008)", async () => {
    const sharedId = 7;
    const archives = [
      makeDefaultArchive({
        id: "a1000000-0000-0000-0000-000000000001",
        reviewed: true,
        completedAt: new Date("2026-04-10T00:00:00Z"),
        rankedItems: [{ rawItemId: sharedId, score: 0.9, rationale: "x" }],
      }),
      makeDefaultArchive({
        id: "a2000000-0000-0000-0000-000000000002",
        reviewed: true,
        completedAt: new Date("2026-04-09T00:00:00Z"),
        rankedItems: [{ rawItemId: sharedId, score: 0.8, rationale: "y" }],
      }),
      makeDefaultArchive({
        id: "a3000000-0000-0000-0000-000000000003",
        reviewed: true,
        completedAt: new Date("2026-04-08T00:00:00Z"),
        rankedItems: [{ rawItemId: sharedId, score: 0.7, rationale: "z" }],
      }),
    ];
    const db = makeFakeDbReviewed(archives);
    const rawRows: Partial<RawItemRow>[] = [{ id: sharedId, title: "Shared", sourceType: "hn" }];
    const { repo, spy } = makeFakeRawItemsRepo(rawRows);
    await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][0]).toHaveLength(1);
    expect(spy.mock.calls[0][0][0]).toBe(sharedId);
  });

  // 11. REQ-009: topItems title comes from raw row, not from rankedItemRef phantom fields
  it("topItems title comes from raw row not from rankedItemRef phantom field (REQ-009)", async () => {
    const ref = { rawItemId: 7, score: 0.9, rationale: "x" } as unknown as RankedItemRef & { title: string };
    ref.title = "bogus title from ref";
    const archive = makeDefaultArchive({ reviewed: true, rankedItems: [ref] });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [{ id: 7, title: "Real Title From Raw", sourceType: "hn" }];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].topItems[0].title).toBe("Real Title From Raw");
  });

  // 12. EDGE-001: zero reviewed rows → returns [] and findByIds never called
  it("returns [] and never calls findByIds when no reviewed archives exist (EDGE-001)", async () => {
    const db = makeFakeDbReviewed([]);
    const { repo, spy } = makeFakeRawItemsRepo([]);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result).toEqual([]);
    expect(spy.mock.calls).toHaveLength(0);
  });

  // 13. EDGE-002: row with empty rankedItems → topItems=[], leadSummary=null, storyCount=0
  it("returns topItems=[], leadSummary=null, storyCount=0 for row with no rankedItems (EDGE-002)", async () => {
    const archive = makeDefaultArchive({ reviewed: true, rankedItems: [] });
    const db = makeFakeDbReviewed([archive]);
    const { repo } = makeFakeRawItemsRepo([]);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].topItems).toEqual([]);
    expect(result[0].leadSummary).toBeNull();
    expect(result[0].storyCount).toBe(0);
  });

  // 14. EDGE-003: row with exactly 1 rankedItem → topItems.length = 1
  it("returns topItems of length 1 when only 1 rankedItem (EDGE-003)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 5, score: 0.9, rationale: "x" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [{ id: 5, title: "Five", sourceType: "hn" }];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].topItems).toHaveLength(1);
    expect(result[0].topItems[0].id).toBe(5);
  });

  // 15. EDGE-004: exactly 3 rankedItems → topItems.length = 3
  it("returns topItems of length 3 when exactly 3 rankedItems all present (EDGE-004)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [
        { rawItemId: 1, score: 0.9, rationale: "a" },
        { rawItemId: 2, score: 0.8, rationale: "b" },
        { rawItemId: 3, score: 0.7, rationale: "c" },
      ],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 1, title: "One", sourceType: "hn" },
      { id: 2, title: "Two", sourceType: "reddit" },
      { id: 3, title: "Three", sourceType: "hn" },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    // EDGE-004: exactly 3 — no truncation or "+ N more" concern; UI handles that separately
    expect(result[0].topItems).toHaveLength(3);
  });
});
