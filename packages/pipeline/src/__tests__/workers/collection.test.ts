import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";

vi.mock("bullmq", () => ({
  Worker: vi.fn(),
}));

vi.mock("../../collectors/hn.js", () => ({
  collectHn: vi.fn(),
}));

vi.mock("@newsletter/shared/db", () => ({
  getDb: vi.fn(() => ({ fake: "db" })),
  rawItems: {},
  createRedisConnection: vi.fn(),
}));

const { collectHn } = await import("../../collectors/hn.js");
const { getDb } = await import("@newsletter/shared/db");
const { handleCollectionJob } = await import("../../workers/collection.js");

const mockCollectHn = vi.mocked(collectHn);
const mockGetDb = vi.mocked(getDb);

describe("collection worker dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REQ-001: HN collector is wired into the BullMQ collection worker
  it("dispatches hn-collect jobs to collectHn with db and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 5,
      commentsFetched: 10,
      itemsStored: 5,
      durationMs: 1200,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    const fakeJob = {
      name: "hn-collect",
      data: {
        config: { pointsThreshold: 100, count: 5 },
      },
    };

    const result = await handleCollectionJob(fakeJob as Parameters<typeof handleCollectionJob>[0]);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(mockCollectHn).toHaveBeenCalledOnce();
    expect(mockCollectHn).toHaveBeenCalledWith(
      { db: mockGetDb.mock.results[0]?.value },
      { pointsThreshold: 100, count: 5 },
    );
    expect(result).toEqual(fakeResult);
  });

  // REQ-009: Structured error handling for unknown collectors
  it("returns the CollectorResult from collectHn", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 3,
      commentsFetched: 0,
      itemsStored: 3,
      durationMs: 800,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    const fakeJob = {
      name: "hn-collect",
      data: { config: {} },
    };

    const result = await handleCollectionJob(fakeJob as Parameters<typeof handleCollectionJob>[0]);
    expect(result).toEqual(fakeResult);
  });

  // EDGE-008: Unknown job names throw descriptive errors
  it("throws a descriptive error for unknown job names", async () => {
    const fakeJob = {
      name: "reddit-collect",
      data: { config: {} },
    };

    await expect(
      handleCollectionJob(fakeJob as Parameters<typeof handleCollectionJob>[0]),
    ).rejects.toThrow("Unknown collector: reddit-collect");
  });

  it("does not call collectHn for unknown job names", async () => {
    const fakeJob = {
      name: "unknown-source",
      data: { config: {} },
    };

    try {
      await handleCollectionJob(fakeJob as Parameters<typeof handleCollectionJob>[0]);
    } catch {
      // expected
    }

    expect(mockCollectHn).not.toHaveBeenCalled();
  });
});
