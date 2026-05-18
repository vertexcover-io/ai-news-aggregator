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
    const updated = await repo.updateRankedItems("run-1", newItems, {
      rawItemsById: new Map(),
      digestHeadline: null,
      digestSummary: null,
    });

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

  it("buildTopItems title precedence: ref.title > recap.title > row.title", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [
        // ref.title set
        { rawItemId: 100, score: 0.9, rationale: "a", title: "ref-override" },
        // ref.title absent → recap.title used
        { rawItemId: 200, score: 0.8, rationale: "b" },
        // neither set → row.title fallback
        { rawItemId: 300, score: 0.7, rationale: "c" },
      ],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 100, title: "source-100", sourceType: "hn" },
      {
        id: 200,
        title: "source-200",
        sourceType: "hn",
        metadata: {
          comments: [],
          recap: {
            title: "ai-title-200",
            summary: "s",
            bullets: ["b"],
            bottomLine: "bl",
          },
        },
      },
      { id: 300, title: "source-300", sourceType: "hn" },
    ];
    const { repo } = makeFakeRawItemsRepo(rawRows);
    const result = await createRunArchivesRepo(db).listReviewed({ rawItemsRepo: repo });
    expect(result[0].topItems[0].title).toBe("ref-override");
    expect(result[0].topItems[1].title).toBe("ai-title-200");
    expect(result[0].topItems[2].title).toBe("source-300");
  });

  // 3. REQ-006: override summary takes precedence over raw recap
  it("uses override summary from rankedItems ref when present (REQ-006)", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x", summary: "override" }],
    });
    const db = makeFakeDbReviewed([archive]);
    const rawRows: Partial<RawItemRow>[] = [
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { title: "T", summary: "raw", bullets: [], bottomLine: "" } } },
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
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { title: "T", summary: "raw summary", bullets: [], bottomLine: "" } } },
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
      { id: 7, title: "Seven", sourceType: "hn", metadata: { comments: [], recap: { title: "T", summary: "raw", bullets: [], bottomLine: "" } } },
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

  // 11. topItems title falls back to raw row when ref.title and recap.title absent
  it("topItems title falls back to raw row title when ref.title and recap.title are absent", async () => {
    const archive = makeDefaultArchive({
      reviewed: true,
      rankedItems: [{ rawItemId: 7, score: 0.9, rationale: "x" }],
    });
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

// ---------------------------------------------------------------------------
// findMostRecentReviewed — used by the confirm flow to send the most recent
// reviewed digest to a newly-confirmed subscriber, regardless of date.
// ---------------------------------------------------------------------------

function makeFakeDbForMostRecent(rows: StoredArchive[]): Pick<AppDb, "select" | "update"> {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) =>
              Promise.resolve(rows.filter((r) => r.reviewed).slice(0, n)),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  } as unknown as Pick<AppDb, "select" | "update">;
}

describe("RunArchivesRepo social-marker methods", () => {
  function makeUpdateCaptureDb(): {
    db: Pick<AppDb, "select" | "update" | "execute">;
    setSpy: ReturnType<typeof vi.fn>;
    whereSpy: ReturnType<typeof vi.fn>;
  } {
    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn(() => ({ where: whereSpy }));
    const updateSpy = vi.fn(() => ({ set: setSpy }));
    const selectSpy = vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([]) }),
    }));
    const executeSpy = vi.fn().mockResolvedValue([]);
    const db = {
      select: selectSpy,
      update: updateSpy,
      execute: executeSpy,
    } as unknown as Pick<AppDb, "select" | "update" | "execute">;
    return { db, setSpy, whereSpy };
  }

  it("markLinkedInPosted sets timestamp + socialMetadata when permalink present", async () => {
    const { db, setSpy } = makeUpdateCaptureDb();
    const repo = createRunArchivesRepo(db);
    const at = new Date("2026-05-11T12:00:00Z");
    await repo.markLinkedInPosted("run-1", at, "urn:li:share:42");
    const patch = setSpy.mock.calls[0]?.[0];
    expect(patch.linkedinPostedAt).toBe(at);
    expect(patch.socialMetadata).toBeDefined();
  });

  it("markLinkedInPosted writes only timestamp when permalink is null", async () => {
    const { db, setSpy } = makeUpdateCaptureDb();
    const repo = createRunArchivesRepo(db);
    const at = new Date("2026-05-11T12:00:00Z");
    await repo.markLinkedInPosted("run-1", at, null);
    const patch = setSpy.mock.calls[0]?.[0];
    expect(patch.linkedinPostedAt).toBe(at);
    expect(patch.socialMetadata).toBeUndefined();
  });

  it("markTwitterPosted sets timestamp + socialMetadata", async () => {
    const { db, setSpy } = makeUpdateCaptureDb();
    const repo = createRunArchivesRepo(db);
    const at = new Date("2026-05-11T12:00:00Z");
    await repo.markTwitterPosted("run-1", at, "https://x.com/i/web/status/9");
    const patch = setSpy.mock.calls[0]?.[0];
    expect(patch.twitterPostedAt).toBe(at);
    expect(patch.socialMetadata).toBeDefined();
  });

  it("recordSocialFailure writes only social_metadata error, no posted_at", async () => {
    const { db, setSpy } = makeUpdateCaptureDb();
    const repo = createRunArchivesRepo(db);
    await repo.recordSocialFailure("run-1", "twitter", "rate limited");
    const patch = setSpy.mock.calls[0]?.[0];
    expect(patch.twitterPostedAt).toBeUndefined();
    expect(patch.linkedinPostedAt).toBeUndefined();
    expect(patch.socialMetadata).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// delete() — Phase 1 (REQ-8, REQ-9, REQ-12)
// ---------------------------------------------------------------------------

interface DeleteSpies {
  db: Pick<AppDb, "select" | "update" | "execute" | "delete" | "transaction">;
  transactionSpy: ReturnType<typeof vi.fn>;
  emailSendsDeleteSpy: ReturnType<typeof vi.fn>;
  archivesDeleteSpy: ReturnType<typeof vi.fn>;
  deleteCallOrder: string[];
}

function makeDeleteCapturingDb(opts: {
  emailSendsReturned: { id: string }[];
  archivesReturned: { id: string }[];
}): DeleteSpies {
  const deleteCallOrder: string[] = [];
  const emailSendsDeleteSpy = vi.fn();
  const archivesDeleteSpy = vi.fn();

  // Whether the next tx.delete() refers to emailSends or runArchives is
  // determined by the order of calls inside the implementation (per the
  // spec: emailSends first, then runArchives).
  let nextDeleteIndex = 0;

  function buildTx(): { delete: ReturnType<typeof vi.fn> } {
    const txDelete = vi.fn(() => {
      const callIdx = nextDeleteIndex++;
      const isEmailSends = callIdx === 0;
      deleteCallOrder.push(isEmailSends ? "emailSends" : "runArchives");
      const spy = isEmailSends ? emailSendsDeleteSpy : archivesDeleteSpy;
      spy();
      const returning = vi.fn().mockResolvedValue(
        isEmailSends ? opts.emailSendsReturned : opts.archivesReturned,
      );
      const where = vi.fn(() => ({ returning }));
      return { where };
    });
    return { delete: txDelete };
  }

  const transactionSpy = vi.fn(
    async <T>(cb: (tx: { delete: ReturnType<typeof vi.fn> }) => Promise<T>): Promise<T> => {
      nextDeleteIndex = 0;
      return cb(buildTx());
    },
  );

  const db = {
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    delete: vi.fn(),
    transaction: transactionSpy,
  } as unknown as Pick<AppDb, "select" | "update" | "execute" | "delete" | "transaction">;

  return {
    db,
    transactionSpy,
    emailSendsDeleteSpy,
    archivesDeleteSpy,
    deleteCallOrder,
  };
}

describe("RunArchivesRepo.delete (REQ-8, REQ-9, REQ-12)", () => {
  it("returns { deleted: true, removedEmailSends: N } and deletes email_sends before run_archives", async () => {
    const spies = makeDeleteCapturingDb({
      emailSendsReturned: [{ id: "es-1" }, { id: "es-2" }],
      archivesReturned: [{ id: "00000000-0000-0000-0000-000000000001" }],
    });
    const repo = createRunArchivesRepo(spies.db);
    const result = await repo.delete("00000000-0000-0000-0000-000000000001");
    expect(result).toEqual({ deleted: true, removedEmailSends: 2 });
    expect(spies.deleteCallOrder).toEqual(["emailSends", "runArchives"]);
    expect(spies.emailSendsDeleteSpy).toHaveBeenCalledOnce();
    expect(spies.archivesDeleteSpy).toHaveBeenCalledOnce();
  });

  it("returns { deleted: false, removedEmailSends: 0 } when the archive does not exist (REQ-9)", async () => {
    const spies = makeDeleteCapturingDb({
      emailSendsReturned: [],
      archivesReturned: [],
    });
    const repo = createRunArchivesRepo(spies.db);
    const result = await repo.delete("00000000-0000-0000-0000-000000000099");
    expect(result).toEqual({ deleted: false, removedEmailSends: 0 });
  });

  it("performs all deletes inside a single db.transaction call", async () => {
    const spies = makeDeleteCapturingDb({
      emailSendsReturned: [{ id: "es-1" }],
      archivesReturned: [{ id: "00000000-0000-0000-0000-000000000001" }],
    });
    const repo = createRunArchivesRepo(spies.db);
    await repo.delete("00000000-0000-0000-0000-000000000001");
    expect(spies.transactionSpy).toHaveBeenCalledOnce();
  });
});

describe("findMostRecentReviewed", () => {
  it("returns null when no reviewed archives exist", async () => {
    const db = makeFakeDbForMostRecent([]);
    const result = await createRunArchivesRepo(db).findMostRecentReviewed();
    expect(result).toBeNull();
  });

  it("ignores non-reviewed archives", async () => {
    const archive = makeDefaultArchive({ reviewed: false });
    const db = makeFakeDbForMostRecent([archive]);
    const result = await createRunArchivesRepo(db).findMostRecentReviewed();
    expect(result).toBeNull();
  });

  it("returns the only reviewed archive's id when one exists", async () => {
    const archive = makeDefaultArchive({
      id: "00000000-0000-0000-0000-0000000000aa",
      reviewed: true,
    });
    const db = makeFakeDbForMostRecent([archive]);
    const result = await createRunArchivesRepo(db).findMostRecentReviewed();
    expect(result).toEqual({ id: "00000000-0000-0000-0000-0000000000aa" });
  });

  it("returns the most recent reviewed archive when multiple exist (most-recent first)", async () => {
    const older = makeDefaultArchive({
      id: "00000000-0000-0000-0000-0000000000aa",
      reviewed: true,
      completedAt: new Date("2026-04-09T00:00:00Z"),
    });
    const newer = makeDefaultArchive({
      id: "00000000-0000-0000-0000-0000000000bb",
      reviewed: true,
      completedAt: new Date("2026-04-10T00:00:00Z"),
    });
    // Fake db respects the provided order; production query enforces ORDER BY completedAt DESC LIMIT 1.
    const db = makeFakeDbForMostRecent([newer, older]);
    const result = await createRunArchivesRepo(db).findMostRecentReviewed();
    expect(result).toEqual({ id: "00000000-0000-0000-0000-0000000000bb" });
  });
});
