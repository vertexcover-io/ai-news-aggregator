import { describe, it, expect, vi, afterEach } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";
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

afterEach(() => {
  vi.useRealTimers();
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
