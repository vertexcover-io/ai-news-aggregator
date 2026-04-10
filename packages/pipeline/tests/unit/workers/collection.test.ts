import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { RunStateService } from "@pipeline/services/run-state.js";
import type { CollectionWorkerDeps } from "@pipeline/workers/collection.js";

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

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getDb: vi.fn(() => ({ fake: "db" })),
  };
});

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: mockLoggerWarn,
  })),
}));

vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ upsertItems: vi.fn() })),
}));

const { collectHn } = await import("@pipeline/collectors/hn.js");
const { collectReddit } = await import("@pipeline/collectors/reddit.js");
const { collectWeb } = await import("@pipeline/collectors/web.js");
const { handleCollectionJob } = await import("@pipeline/workers/collection.js");

const mockCollectHn = vi.mocked(collectHn);
const mockCollectReddit = vi.mocked(collectReddit);
const mockCollectWeb = vi.mocked(collectWeb);

function makeDeps(): {
  deps: CollectionWorkerDeps;
  rawItemsRepo: RawItemsRepo;
  updateSource: ReturnType<typeof vi.fn>;
  setStage: ReturnType<typeof vi.fn>;
} {
  const rawItemsRepo: RawItemsRepo = {
    upsertItems: vi.fn(() => Promise.resolve()),
    findExistingExternalIds: vi.fn(() => Promise.resolve(new Set())),
  };
  const updateSource = vi.fn(() => Promise.resolve());
  const setStage = vi.fn(() => Promise.resolve());
  const runState: RunStateService = {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve(null)),
    updateSource,
    setStage,
  };
  return { deps: { rawItemsRepo, runState }, rawItemsRepo, updateSource, setStage };
}

describe("collection worker dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
  });

  // REQ-001: HN collector is wired into the BullMQ collection worker
  it("dispatches hn-collect jobs to collectHn with the injected repo and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 5,
      commentsFetched: 10,
      itemsStored: 5,
      durationMs: 1200,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    const { deps, rawItemsRepo } = makeDeps();
    const fakeJob = {
      name: "hn-collect",
      data: { config: { pointsThreshold: 100, count: 5 } },
    };

    const result = await handleCollectionJob(fakeJob, deps);

    expect(mockCollectHn).toHaveBeenCalledOnce();
    expect(mockCollectHn).toHaveBeenCalledWith(
      { rawItemsRepo },
      { pointsThreshold: 100, count: 5 },
    );
    expect(result).toEqual(fakeResult);
  });

  it("returns the CollectorResult from collectHn", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 3,
      commentsFetched: 0,
      itemsStored: 3,
      durationMs: 800,
    };
    mockCollectHn.mockResolvedValue(fakeResult);

    const { deps } = makeDeps();
    const result = await handleCollectionJob(
      { name: "hn-collect", data: { config: {} } },
      deps,
    );
    expect(result).toEqual(fakeResult);
  });

  // REQ-001: Reddit collector is wired into the BullMQ collection worker
  it("dispatches reddit-collect jobs to collectReddit with the injected repo and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 8,
      commentsFetched: 15,
      itemsStored: 8,
      durationMs: 2000,
    };
    mockCollectReddit.mockResolvedValue(fakeResult);

    const { deps, rawItemsRepo } = makeDeps();
    const fakeJob = {
      name: "reddit-collect",
      data: {
        config: { subreddits: ["MachineLearning"], sort: "top" as const },
      },
    };

    const result = await handleCollectionJob(fakeJob, deps);

    expect(mockCollectReddit).toHaveBeenCalledOnce();
    expect(mockCollectReddit).toHaveBeenCalledWith(
      { rawItemsRepo },
      { subreddits: ["MachineLearning"], sort: "top" },
    );
    expect(result).toEqual(fakeResult);
  });

  // REQ-001/002: Web collector is wired into the BullMQ collection worker
  it("dispatches web-collect jobs to collectWeb with the injected repo and config", async () => {
    const fakeResult: CollectorResult = {
      itemsFetched: 2,
      commentsFetched: 0,
      itemsStored: 2,
      durationMs: 500,
    };
    mockCollectWeb.mockResolvedValue(fakeResult);

    const { deps, rawItemsRepo } = makeDeps();
    const fakeJob = {
      name: "web-collect",
      data: {
        config: {
          sources: [{ name: "example", listingUrl: "https://example.com/blog" }],
          maxItems: 5,
        },
      },
    };

    const result = await handleCollectionJob(fakeJob, deps);

    expect(mockCollectWeb).toHaveBeenCalledOnce();
    expect(mockCollectWeb).toHaveBeenCalledWith(
      { rawItemsRepo },
      {
        sources: [{ name: "example", listingUrl: "https://example.com/blog" }],
        maxItems: 5,
      },
    );
    expect(result).toEqual(fakeResult);
  });

  // EDGE-008: Unknown job names throw descriptive errors
  it("throws a descriptive error for unknown job names", async () => {
    const { deps } = makeDeps();
    await expect(
      handleCollectionJob(
        { name: "twitter-collect", data: { config: {} } },
        deps,
      ),
    ).rejects.toThrow("Unknown collector: twitter-collect");
  });

  it("does not call collectHn for unknown job names", async () => {
    const { deps } = makeDeps();
    try {
      await handleCollectionJob(
        { name: "unknown-source", data: { config: {} } },
        deps,
      );
    } catch {
      // expected
    }
    expect(mockCollectHn).not.toHaveBeenCalled();
  });

  it("does not call collectReddit for unknown job names", async () => {
    const { deps } = makeDeps();
    try {
      await handleCollectionJob(
        { name: "unknown-source", data: { config: {} } },
        deps,
      );
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

    const { deps, updateSource, setStage } = makeDeps();
    await handleCollectionJob(
      { name: "hn-collect", data: { config: {} } },
      deps,
    );

    expect(updateSource).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
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

    const { deps, updateSource, setStage } = makeDeps();
    await handleCollectionJob(
      { name: "hn-collect", data: { runId: "run-42", config: {} } },
      deps,
    );

    expect(updateSource).toHaveBeenNthCalledWith(1, "run-42", "hn", {
      status: "running",
    });
    expect(setStage).toHaveBeenCalledWith("run-42", "collecting");
    expect(updateSource).toHaveBeenNthCalledWith(2, "run-42", "hn", {
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

    const { deps } = makeDeps();
    await handleCollectionJob(
      {
        name: "reddit-collect",
        data: {
          runId: "run-99",
          config: { subreddits: ["MachineLearning"], sort: "top" as const },
        },
      },
      deps,
    );

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

    const { deps, updateSource } = makeDeps();
    await expect(
      handleCollectionJob(
        { name: "hn-collect", data: { runId: "run-7", config: {} } },
        deps,
      ),
    ).rejects.toThrow("fetch exploded");

    expect(updateSource).toHaveBeenNthCalledWith(1, "run-7", "hn", {
      status: "running",
    });
    expect(updateSource).toHaveBeenLastCalledWith("run-7", "hn", {
      status: "failed",
      errors: ["fetch exploded"],
    });
  });

  // REQ-082: Emits run.source.failed log on failure
  it("emits run.source.failed log on collector throw", async () => {
    mockCollectHn.mockRejectedValue(new Error("boom"));

    const { deps } = makeDeps();
    await expect(
      handleCollectionJob(
        { name: "hn-collect", data: { runId: "run-11", config: {} } },
        deps,
      ),
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
