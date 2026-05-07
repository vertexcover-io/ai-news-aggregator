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
      sourceTelemetry: null,
    });
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
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
