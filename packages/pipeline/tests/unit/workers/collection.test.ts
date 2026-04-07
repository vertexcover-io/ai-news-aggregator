import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";

const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();

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
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: mockLoggerWarn,
  })),
}));

const mockUpdateSource = vi.fn(() => Promise.resolve());
const mockSetStage = vi.fn(() => Promise.resolve());

vi.mock("@pipeline/services/run-state.js", async () => {
  const actual =
    await vi.importActual<typeof import("@pipeline/services/run-state.js")>(
      "@pipeline/services/run-state.js",
    );
  return {
    ...actual,
    createRunStateService: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
      updateSource: mockUpdateSource,
      setStage: mockSetStage,
    })),
  };
});

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
    mockUpdateSource.mockClear();
    mockSetStage.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
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

  // REQ-001/002: Web collector is wired into the BullMQ collection worker
  it("dispatches web-collect jobs to collectWeb with db and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 2,
      commentsFetched: 0,
      itemsStored: 2,
      durationMs: 500,
    };
    mockCollectWeb.mockResolvedValue(fakeResult);

    const fakeJob = {
      name: "web-collect",
      data: {
        config: {
          sources: [{ name: "example", listingUrl: "https://example.com/blog" }],
          maxItems: 5,
        },
      },
    };

    const result = await handleCollectionJob(fakeJob);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(mockCreateRawItemsRepo).toHaveBeenCalledOnce();
    expect(mockCollectWeb).toHaveBeenCalledOnce();
    expect(mockCollectWeb).toHaveBeenCalledWith(
      { rawItemsRepo: mockCreateRawItemsRepo.mock.results[0]?.value },
      {
        sources: [{ name: "example", listingUrl: "https://example.com/blog" }],
        maxItems: 5,
      },
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

  // REQ-030: Backward-compat — jobs without runId do not touch run-state
  it("does not call run-state service when runId is absent", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 2,
      commentsFetched: 0,
      itemsStored: 2,
      durationMs: 500,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    await handleCollectionJob({
      name: "hn-collect",
      data: { config: {} },
    });

    expect(mockUpdateSource).not.toHaveBeenCalled();
    expect(mockSetStage).not.toHaveBeenCalled();
  });

  // REQ-031: Success path with runId transitions source running → completed
  it("transitions source status on success when runId is provided", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 6,
      commentsFetched: 4,
      itemsStored: 6,
      durationMs: 900,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    await handleCollectionJob({
      name: "hn-collect",
      data: { runId: "run-42", config: {} },
    });

    expect(mockUpdateSource).toHaveBeenNthCalledWith(1, "run-42", "hn", {
      status: "running",
    });
    expect(mockSetStage).toHaveBeenCalledWith("run-42", "collecting");
    expect(mockUpdateSource).toHaveBeenNthCalledWith(2, "run-42", "hn", {
      status: "completed",
      itemsFetched: 6,
    });
  });

  // REQ-081: Emits run.source.completed log on success
  it("emits run.source.completed log with runId, sourceType, itemsFetched, durationMs", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 3,
      commentsFetched: 0,
      itemsStored: 3,
      durationMs: 0,
    };
    mockCollectReddit.mockResolvedValue(fakeResult);

    await handleCollectionJob({
      name: "reddit-collect",
      data: {
        runId: "run-99",
        config: { subreddits: ["MachineLearning"], sort: "top" as const },
      },
    });

    const completedCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as { event?: string }).event === "run.source.completed",
    );
    expect(completedCall).toBeDefined();
    const payload = completedCall?.[0] as {
      event: string;
      runId: string;
      sourceType: string;
      itemsFetched: number;
      durationMs: number;
    };
    expect(payload.runId).toBe("run-99");
    expect(payload.sourceType).toBe("reddit");
    expect(payload.itemsFetched).toBe(3);
    expect(typeof payload.durationMs).toBe("number");
  });

  // REQ-032: Collector failure transitions source to failed and rethrows
  it("marks source failed and rethrows when collector throws", async () => {
    mockCollectHn.mockRejectedValue(new Error("fetch exploded"));

    await expect(
      handleCollectionJob({
        name: "hn-collect",
        data: { runId: "run-7", config: {} },
      }),
    ).rejects.toThrow("fetch exploded");

    expect(mockUpdateSource).toHaveBeenNthCalledWith(1, "run-7", "hn", {
      status: "running",
    });
    expect(mockUpdateSource).toHaveBeenLastCalledWith("run-7", "hn", {
      status: "failed",
      errors: ["fetch exploded"],
    });
  });

  // REQ-082: Emits run.source.failed log on failure
  it("emits run.source.failed log on collector throw", async () => {
    mockCollectHn.mockRejectedValue(new Error("boom"));

    await expect(
      handleCollectionJob({
        name: "hn-collect",
        data: { runId: "run-11", config: {} },
      }),
    ).rejects.toThrow("boom");

    const failedCall = mockLoggerError.mock.calls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as { event?: string }).event === "run.source.failed",
    );
    expect(failedCall).toBeDefined();
    const payload = failedCall?.[0] as {
      event: string;
      runId: string;
      sourceType: string;
      error: string;
    };
    expect(payload.runId).toBe("run-11");
    expect(payload.sourceType).toBe("hn");
    expect(payload.error).toBe("boom");
  });
});
