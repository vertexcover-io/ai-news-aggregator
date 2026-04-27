import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name, handler, opts) => ({
    name,
    handler,
    options: opts,
    close: vi.fn(),
    on: vi.fn(),
  })),
  Queue: vi.fn().mockImplementation((name, opts) => ({
    name,
    options: opts,
    add: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getDb: vi.fn(() => ({ fake: "db" })),
  };
});

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

const mockHandleRunProcessJob = vi.fn();
vi.mock("@pipeline/workers/run-process.js", () => ({
  handleRunProcessJob: (...args: unknown[]) => mockHandleRunProcessJob(...args),
}));

const mockHandleDailyRunJob = vi.fn();
vi.mock("@pipeline/workers/daily-run.js", () => ({
  handleDailyRunJob: (...args: unknown[]) => mockHandleDailyRunJob(...args),
}));

const { createProcessingWorker } = await import(
  "@pipeline/workers/processing.js"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProcessingWorker (single dispatcher Worker on 'processing' queue)", () => {
  function makeWorker(): { handler: (job: unknown) => Promise<unknown> } {
    const w = createProcessingWorker({
      runProcessDeps: { fake: "rp-deps" } as never,
      dailyRunDeps: { fake: "dr-deps" } as never,
      connection: { fake: "redis" } as never,
    });
    return w as unknown as { handler: (job: unknown) => Promise<unknown> };
  }

  it("routes job.name === 'run-process' to handleRunProcessJob", async () => {
    mockHandleRunProcessJob.mockResolvedValue({ rankedCount: 5 });
    const worker = makeWorker();
    const job = {
      name: "run-process",
      id: "j1",
      data: {
        runId: "r1",
        topN: 10,
        sourceTypes: ["hn"],
        collectors: { hn: { topStories: 30 } },
      },
    };
    const result = await worker.handler(job);
    expect(mockHandleRunProcessJob).toHaveBeenCalledOnce();
    expect(mockHandleDailyRunJob).not.toHaveBeenCalled();
    expect(result).toEqual({ rankedCount: 5 });
  });

  it("routes job.name === 'daily-run' to handleDailyRunJob", async () => {
    mockHandleDailyRunJob.mockResolvedValue(undefined);
    const worker = makeWorker();
    const job = { name: "daily-run", id: "j2", data: {} };
    await worker.handler(job);
    expect(mockHandleDailyRunJob).toHaveBeenCalledOnce();
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
  });

  it("logs a warn and returns undefined for unknown job names", async () => {
    const worker = makeWorker();
    const job = { name: "unknown-job", id: "j3", data: {} };
    const result = await worker.handler(job);
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
    expect(mockHandleDailyRunJob).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("does NOT call handleRunProcessJob and calls logger.error when job.name === 'run-process' but data is invalid", async () => {
    const worker = makeWorker();
    // topN is a string (not a number) — fails isRunProcessJobData guard
    const job = {
      name: "run-process",
      id: "j4",
      data: {
        runId: "r1",
        topN: "not-a-number",
        sourceTypes: ["hn"],
        collectors: { hn: {} },
      },
    };
    const result = await worker.handler(job);
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("does not throw and constructs a Worker when called with no arguments", async () => {
    // This triggers buildDefaultRunProcessDeps and buildDefaultDailyRunDeps,
    // which call getDb() (mocked) and createRedisConnection() (mocked)
    expect(() => createProcessingWorker()).not.toThrow();
    const bullmq = await import("bullmq");
    const WorkerMock = vi.mocked(bullmq.Worker);
    expect(WorkerMock).toHaveBeenCalled();
  });
});
