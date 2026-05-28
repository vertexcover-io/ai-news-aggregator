import { describe, it, expect, vi } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";
import { canonicalizeUrl } from "@pipeline/processors/dedup.js";

describe("run-archives repository", () => {
  const mockInsert = vi.fn();
  const mockValues = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();

  function makeMockDb(): { insert: ReturnType<typeof vi.fn> } {
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockInsert.mockReturnValue({ values: mockValues });
    return { insert: mockInsert };
  }

  // Reset mocks before importing to avoid stale state
  function resetMocks(): void {
    mockInsert.mockReset();
    mockValues.mockReset();
    mockOnConflictDoUpdate.mockReset();
  }

  // REQ-002: upsert inserts a new row
  it("inserts a new archive row", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    const rankedItems: RankedItemRef[] = [
      { rawItemId: 1, score: 0.9, rationale: "top" },
      { rawItemId: 2, score: 0.7, rationale: "good" },
    ];

    await repo.upsert({
      id: "run-abc",
      status: "completed",
      rankedItems,
      topN: 5,
      completedAt: new Date("2026-04-13T12:00:00Z"),
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();
    const insertedValues = mockValues.mock.calls[0]?.[0];
    expect(insertedValues).toEqual({
      id: "run-abc",
      status: "completed",
      rankedItems,
      topN: 5,
      completedAt: new Date("2026-04-13T12:00:00Z"),
      startedAt: null,
      sourceTypes: null,
      reviewed: false,
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
      sourceTelemetry: null,
      searchText: null,
      isDryRun: false,
      runFunnel: null,
      publishedAt: null,
      shortlistedItemIds: null,
      preReviewSnapshot: null,
    });
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
  });

  // Phase 2 (REQ-002): upsert writes publishedAt when provided
  it("writes publishedAt to the row when input.publishedAt is provided", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    const publishedAt = new Date("2026-05-26T10:00:00Z");
    await repo.upsert({
      id: "run-pub",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-25T03:00:00Z"),
      publishedAt,
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as {
      publishedAt: Date | null;
    };
    expect(insertedValues.publishedAt).toEqual(publishedAt);
  });

  // Phase 2 (REQ-003/005): publishedAt defaults to null when omitted
  it("defaults publishedAt to null when omitted", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-nopub",
      status: "failed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-25T03:00:00Z"),
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as {
      publishedAt: Date | null;
    };
    expect(insertedValues.publishedAt).toBeNull();
  });

  // Phase 2: upsert writes isDryRun when provided
  it("writes isDryRun=true to the row when input.isDryRun is true", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-dry",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-18T12:00:00Z"),
      isDryRun: true,
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as { isDryRun: boolean };
    expect(insertedValues.isDryRun).toBe(true);
  });

  it("defaults isDryRun to false when omitted", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-live",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-18T12:00:00Z"),
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as { isDryRun: boolean };
    expect(insertedValues.isDryRun).toBe(false);
  });

  describe("social-marker methods", () => {
    function makeUpdateOnlyDb(): {
      db: { update: ReturnType<typeof vi.fn> };
      setSpy: ReturnType<typeof vi.fn>;
      whereSpy: ReturnType<typeof vi.fn>;
    } {
      const whereSpy = vi.fn().mockResolvedValue(undefined);
      const setSpy = vi.fn(() => ({ where: whereSpy }));
      const updateSpy = vi.fn(() => ({ set: setSpy }));
      return { db: { update: updateSpy }, setSpy, whereSpy };
    }

    it("markLinkedInPosted writes timestamp + merges permalink into social_metadata", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markLinkedInPosted("run-x", at, "urn:li:share:123");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeDefined();
    });

    it("markLinkedInPosted skips JSON merge when permalink is null", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markLinkedInPosted("run-x", at, null);
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeUndefined();
    });

    it("markTwitterPosted writes timestamp + merges permalink", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markTwitterPosted("run-x", at, "https://x.com/i/web/status/1");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.twitterPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeDefined();
    });

    it("recordSocialFailure writes only error into social_metadata, no posted_at", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      await repo.recordSocialFailure("run-x", "linkedin", "401 Unauthorized");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBeUndefined();
      expect(patch.twitterPostedAt).toBeUndefined();
      expect(patch.socialMetadata).toBeDefined();
    });
  });

  // REQ-007: upsert updates an existing row on conflict
  it("uses onConflictDoUpdate targeting the id column", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-existing",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-04-13T14:00:00Z"),
    });

    const conflictConfig = mockOnConflictDoUpdate.mock.calls[0]?.[0];
    expect(conflictConfig).toBeDefined();
    expect(conflictConfig.target).toBeDefined();
    expect(conflictConfig.set).toBeDefined();
  });

  // REQ-001: upsert writes shortlistedItemIds when provided
  it("writes shortlistedItemIds to the row when provided", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-shortlist",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-26T12:00:00Z"),
      shortlistedItemIds: [10, 20, 30],
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as {
      shortlistedItemIds: number[] | null;
    };
    expect(insertedValues.shortlistedItemIds).toEqual([10, 20, 30]);
  });

  // Partial-update precondition: failed run leaves shortlistedItemIds NULL
  it("writes shortlistedItemIds=null when not provided (failed run path)", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-failed",
      status: "failed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-26T12:00:00Z"),
      // no shortlistedItemIds
    });

    const insertedValues = mockValues.mock.calls[0]?.[0] as {
      shortlistedItemIds: number[] | null;
    };
    expect(insertedValues.shortlistedItemIds).toBeNull();
  });

  // REQ-001: shortlistedItemIds is included in onConflictDoUpdate set
  it("includes shortlistedItemIds in the onConflictDoUpdate set", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);

    await repo.upsert({
      id: "run-conflict",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-26T12:00:00Z"),
      shortlistedItemIds: [1, 2, 3],
    });

    const conflictConfig = mockOnConflictDoUpdate.mock.calls[0]?.[0];
    expect(conflictConfig.set).toHaveProperty("shortlistedItemIds");
  });

  // REQ-001 (Phase 2): preReviewSnapshot is written when provided
  it("writes preReviewSnapshot to the row when provided (REQ-001)", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);
    const snapshot = {
      capturedAt: "2026-05-28T12:00:00.000Z",
      rankedItemIds: [1, 2],
      recap: {
        1: { title: "T1", summary: "S1", bullets: [], bottomLine: "BL1" },
        2: { title: "T2", summary: "S2", bullets: ["B"], bottomLine: "BL2" },
      },
      digestMeta: { headline: "H", summary: "S", hook: null, twitterSummary: null },
    };
    await repo.upsert({
      id: "run-snap",
      status: "completed",
      rankedItems: [],
      topN: 2,
      completedAt: new Date("2026-05-28T12:00:00Z"),
      preReviewSnapshot: snapshot,
    });
    const insertedValues = mockValues.mock.calls[0]?.[0] as { preReviewSnapshot: unknown };
    expect(insertedValues.preReviewSnapshot).toEqual(snapshot);
  });

  // REQ-001 (Phase 2): preReviewSnapshot defaults to null when omitted
  it("defaults preReviewSnapshot to null when omitted (REQ-001)", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);
    await repo.upsert({
      id: "run-no-snap",
      status: "failed",
      rankedItems: [],
      topN: 0,
      completedAt: new Date("2026-05-28T12:00:00Z"),
    });
    const insertedValues = mockValues.mock.calls[0]?.[0] as { preReviewSnapshot: unknown };
    expect(insertedValues.preReviewSnapshot).toBeNull();
  });

  // REQ-008: preReviewSnapshot is included in the onConflictDoUpdate set
  it("includes preReviewSnapshot in the onConflictDoUpdate set (REQ-008)", async () => {
    resetMocks();
    const db = makeMockDb();
    const { createRunArchivesRepo } = await import(
      "@pipeline/repositories/run-archives.js"
    );
    const repo = createRunArchivesRepo(db as never);
    await repo.upsert({
      id: "run-conflict-snap",
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-28T12:00:00Z"),
    });
    const conflictConfig = mockOnConflictDoUpdate.mock.calls[0]?.[0];
    expect(conflictConfig.set).toHaveProperty("preReviewSnapshot");
  });

  // REQ-003/REQ-005: getPublishedCanonicalUrls returns only reviewed, !isDryRun, status=completed
  describe("getPublishedCanonicalUrls", () => {
    it("calls db.select to fetch qualifying archives and resolves URLs", async () => {
      // Use a mock db that tracks what was queried
      const selectCalls: unknown[] = [];
      let callCount = 0;

      const db = {
        select: vi.fn((cols?: unknown) => {
          selectCalls.push(cols);
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => {
                callCount++;
                if (callCount === 1) {
                  // archives query: return empty so no URLs needed
                  return Promise.resolve([]);
                }
                return Promise.resolve([]);
              }),
            })),
          };
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      // db.select should have been called at least once (for archives)
      expect(db.select).toHaveBeenCalled();
    });

    it("returns canonicalized URLs from qualifying archives (REQ-003)", async () => {
      // We need a db that returns archive rows with rawItemIds, then raw_item URLs
      const archiveRows = [
        {
          rankedItems: [
            { rawItemId: 1, score: 0.9, rationale: "top" },
            { rawItemId: 2, score: 0.7, rationale: "good" },
          ],
        },
      ];
      const rawItemRows = [
        { url: "https://Example.com/post?utm_source=rss" },
        { url: "https://example.com/another" },
      ];

      let callCount = 0;
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve(archiveRows);
              return Promise.resolve(rawItemRows);
            }),
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      // URL should be canonicalized (lowercase, tracking stripped)
      expect(result.has(canonicalizeUrl("https://Example.com/post?utm_source=rss"))).toBe(true);
      expect(result.has(canonicalizeUrl("https://example.com/another"))).toBe(true);
    });

    it("returns empty set when there are no qualifying archives (EDGE-005)", async () => {
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([])),
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });
});

// EDGE-004: covered URL filtering + dedup interaction
describe("covered-link filter ordering", () => {
  it("removes a covered URL before dedup (canonical match removes all items with that canonical)", () => {
    // Item 1: covered (its canonical URL is in the published set)
    // Item 2: different canonical URL, NOT covered
    // Item 3: unique URL, NOT covered
    // Filter: removes item 1 since canonical(item1.url) ∈ coveredCanonical
    interface Item { id: number; url: string; engagement: { points: number; commentCount: number }; title: string }
    const coveredCanonical = new Set<string>([
      canonicalizeUrl("https://example.com/covered-post"),
    ]);

    const raw: Item[] = [
      {
        id: 1,
        url: "https://example.com/covered-post", // covered
        engagement: { points: 100, commentCount: 10 },
        title: "Item A (covered)",
      },
      {
        id: 2,
        url: "https://example.com/not-covered-post",
        engagement: { points: 50, commentCount: 5 },
        title: "Item B (not covered)",
      },
      {
        id: 3,
        url: "https://example.com/unique",
        engagement: { points: 80, commentCount: 4 },
        title: "Item C unique",
      },
    ];

    // Simulate the filter as implemented in run-process.ts
    const notCovered = raw.filter(
      (c) => !coveredCanonical.has(canonicalizeUrl(c.url)),
    );

    // Item 1 (covered) should be removed
    expect(notCovered.map((i) => i.id)).not.toContain(1);
    // Items 2 and 3 (not covered) should survive
    expect(notCovered.map((i) => i.id)).toContain(2);
    expect(notCovered.map((i) => i.id)).toContain(3);
  });

  it("when covered URL is the highest-engagement duplicate, filter runs before dedup — covered item removed (EDGE-004)", async () => {
    const { dedupCandidates } = await import("@pipeline/processors/dedup.js");

    interface Item { id: number; url: string; engagement: { points: number; commentCount: number } }

    // Item 10 is covered (its canonical is in the published set).
    // Item 11 is a different URL with a different canonical (not covered).
    // Without filter, dedup would keep item 10 (higher engagement).
    // With filter, item 10 is removed, item 11 survives.
    const coveredCanonical = new Set<string>([
      canonicalizeUrl("https://example.com/covered-article"),
    ]);

    const raw: Item[] = [
      {
        id: 10,
        url: "https://example.com/covered-article", // covered, very high engagement
        engagement: { points: 999, commentCount: 100 },
      },
      {
        id: 11,
        url: "https://example.com/different-article", // NOT covered
        engagement: { points: 50, commentCount: 2 },
      },
    ];

    const notCovered = raw.filter(
      (c) => !coveredCanonical.has(canonicalizeUrl(c.url)),
    );
    // Item 10 removed, item 11 survives
    const deduped = dedupCandidates(notCovered);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe(11);
  });
});
