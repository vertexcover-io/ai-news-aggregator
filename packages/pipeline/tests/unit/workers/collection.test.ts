import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";

vi.mock("bullmq", () => ({
  Worker: vi.fn(),
}));

vi.mock("@pipeline/collectors/hn.js", () => ({
  collectHn: vi.fn(),
}));

vi.mock("@pipeline/collectors/reddit.js", () => ({
  collectReddit: vi.fn(),
}));

vi.mock("@pipeline/collectors/web.js", () => ({
  collectWeb: vi.fn(),
}));

vi.mock("@newsletter/shared/db", () => ({
  getDb: vi.fn(() => ({ fake: "db" })),
  rawItems: {},
  createRedisConnection: vi.fn(),
}));

vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ upsertItems: vi.fn() })),
}));

const { collectHn } = await import("@pipeline/collectors/hn.js");
const { collectReddit } = await import("@pipeline/collectors/reddit.js");
const { collectWeb } = await import("@pipeline/collectors/web.js");
const { getDb } = await import("@newsletter/shared/db");
const { createRawItemsRepo } = await import("@pipeline/repositories/raw-items.js");
const { handleCollectionJob } = await import("@pipeline/workers/collection.js");

const mockCollectHn = vi.mocked(collectHn);
const mockCollectReddit = vi.mocked(collectReddit);
const mockCollectWeb = vi.mocked(collectWeb);
const mockGetDb = vi.mocked(getDb);
const mockCreateRawItemsRepo = vi.mocked(createRawItemsRepo);

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

    const result = await handleCollectionJob(fakeJob);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledWith(mockGetDb.mock.results[0]?.value);
    expect(mockCollectHn).toHaveBeenCalledOnce();
    expect(mockCollectHn).toHaveBeenCalledWith(
      { rawItemsRepo: mockCreateRawItemsRepo.mock.results[0]?.value },
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

    const result = await handleCollectionJob(fakeJob);
    expect(result).toEqual(fakeResult);
  });

  // REQ-001: Reddit collector is wired into the BullMQ collection worker
  it("dispatches reddit-collect jobs to collectReddit with db and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 8,
      commentsFetched: 15,
      itemsStored: 8,
      durationMs: 2000,
    };
    mockCollectReddit.mockResolvedValue(fakeResult);

    const fakeJob = {
      name: "reddit-collect",
      data: {
        config: { subreddits: ["MachineLearning"], sort: "top" as const },
      },
    };

    const result = await handleCollectionJob(fakeJob);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledWith(mockGetDb.mock.results[0]?.value);
    expect(mockCollectReddit).toHaveBeenCalledOnce();
    expect(mockCollectReddit).toHaveBeenCalledWith(
      { rawItemsRepo: mockCreateRawItemsRepo.mock.results[0]?.value },
      { subreddits: ["MachineLearning"], sort: "top" },
    );
    expect(result).toEqual(fakeResult);
  });

  // EDGE-008: Unknown job names throw descriptive errors
  it("throws a descriptive error for unknown job names", async () => {
    const fakeJob = {
      name: "twitter-collect",
      data: { config: {} },
    };

    await expect(
      handleCollectionJob(fakeJob),
    ).rejects.toThrow("Unknown collector: twitter-collect");
  });

  it("does not call collectHn for unknown job names", async () => {
    const fakeJob = {
      name: "unknown-source",
      data: { config: {} },
    };

    try {
      await handleCollectionJob(fakeJob);
    } catch {
      // expected
    }

    expect(mockCollectHn).not.toHaveBeenCalled();
  });

  it("does not call collectReddit for unknown job names", async () => {
    const fakeJob = {
      name: "unknown-source",
      data: { config: {} },
    };

    try {
      await handleCollectionJob(fakeJob);
    } catch {
      // expected
    }

    expect(mockCollectReddit).not.toHaveBeenCalled();
  });

  // REQ-017: Web collector is wired into the BullMQ collection worker
  it("dispatches web-collect jobs to collectWeb with db and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 6,
      commentsFetched: 0,
      itemsStored: 6,
      durationMs: 3500,
    };
    mockCollectWeb.mockResolvedValue(fakeResult);

    const fakeJob = {
      name: "web-collect",
      data: {
        config: {
          sources: [
            {
              name: "OpenAI Blog",
              sourceType: "blog" as const,
              indexUrl: "https://openai.com/blog",
              selectors: {
                articleLink: "a.post-link",
                title: "h1",
                content: "article",
              },
            },
          ],
        },
      },
    };

    const result = await handleCollectionJob(fakeJob);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledWith(mockGetDb.mock.results[0]?.value);
    expect(mockCollectWeb).toHaveBeenCalledOnce();
    expect(mockCollectWeb).toHaveBeenCalledWith(
      { rawItemsRepo: mockCreateRawItemsRepo.mock.results[0]?.value },
      {
        sources: [
          {
            name: "OpenAI Blog",
            sourceType: "blog",
            indexUrl: "https://openai.com/blog",
            selectors: {
              articleLink: "a.post-link",
              title: "h1",
              content: "article",
            },
          },
        ],
      },
    );
    expect(result).toEqual(fakeResult);
  });
});
