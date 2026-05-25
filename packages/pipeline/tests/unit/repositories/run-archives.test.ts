import { describe, it, expect, vi } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";

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
});
