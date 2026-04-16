import { describe, it, expect, vi, afterEach } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef, SourceType } from "@newsletter/shared";
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
