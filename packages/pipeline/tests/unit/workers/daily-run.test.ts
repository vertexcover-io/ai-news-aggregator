import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import type { SourceRecord, SourcesRepo } from "@pipeline/repositories/sources.js";

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, handler, opts) => ({
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

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

const mockStartRun = vi.fn();
vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    startRun: (...args: unknown[]) => mockStartRun(...args),
    getDb: vi.fn(() => ({ fake: "db" })),
  };
});

const { createDailyRunWorker } = await import(
  "@pipeline/workers/daily-run.js"
);

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings-1",
    topN: 5,
    halfLifeHours: 24,
    hnEnabled: true,
    hnConfig: { sinceDays: 1 },
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    scheduleTime: "09:00",
    scheduleTimezone: "America/New_York",
    scheduleEnabled: true,
    updatedAt: "2026-04-14T00:00:00.000Z",
    ...overrides,
  } as UserSettings;
}

function makeSourceRow(
  type: SourceRecord["type"],
  config: unknown,
  enabled = true,
): SourceRecord {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    type,
    config,
    enabled,
    health: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SourceRecord;
}

function makeSourcesRepo(rows: SourceRecord[]): SourcesRepo {
  return {
    list: vi.fn(() => Promise.resolve(rows)),
    listEnabled: vi.fn(() => Promise.resolve(rows.filter((r) => r.enabled))),
    getById: vi.fn(() => Promise.resolve(null)),
    create: vi.fn(() => Promise.reject(new Error("not used"))),
    update: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn(() => Promise.resolve(false)),
    updateHealth: vi.fn(() => Promise.resolve(null)),
  };
}

interface JobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

const baseJob: JobLike = { name: "daily-run", id: "job-1", data: {} };

const hnRow = () => makeSourceRow("hn", { sinceDays: 1 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDailyRunWorker", () => {
  it("calls startRun with collectors assembled from the enabled source rows", async () => {
    const settings = makeSettings();
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(settings)) };
    const sourcesRepo = makeSourcesRepo([hnRow()]);
    mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(userSettingsRepo.get).toHaveBeenCalledOnce();
    expect(sourcesRepo.listEnabled).toHaveBeenCalledOnce();
    expect(mockStartRun).toHaveBeenCalledOnce();
    const [settingsArg, collectorsArg, depsArg] = mockStartRun.mock.calls[0] as [
      UserSettings,
      Record<string, unknown>,
      { redis: unknown; queue: unknown },
    ];
    expect(settingsArg).toBe(settings);
    expect(collectorsArg).toEqual({ hn: { sinceDays: 1 } });
    expect(depsArg.redis).toEqual({ fake: "redis" });
    expect(depsArg.queue).toBeDefined();
  });

  it("calls startRun when a pipeline-run job fires and sources are enabled", async () => {
    const settings = makeSettings();
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(settings)) };
    mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo: makeSourcesRepo([hnRow()]),
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler({ name: "pipeline-run", id: "job-2", data: {} });

    expect(userSettingsRepo.get).toHaveBeenCalledOnce();
    expect(mockStartRun).toHaveBeenCalledOnce();
  });

  // REQ-073: disabled rows must not be collected.
  it("REQ-073: excludes disabled source rows from the assembled collectors", async () => {
    const settings = makeSettings();
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(settings)) };
    const sourcesRepo = makeSourcesRepo([
      hnRow(),
      makeSourceRow("reddit", { subreddit: "MachineLearning", sinceDays: 1 }, false),
    ]);
    mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    const [, collectorsArg] = mockStartRun.mock.calls[0] as [
      UserSettings,
      Record<string, unknown>,
    ];
    expect(collectorsArg).toEqual({ hn: { sinceDays: 1 } });
  });

  it("logs a warning and skips when user_settings is missing", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(null)) };

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo: makeSourcesRepo([hnRow()]),
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    const call = mockLoggerWarn.mock.calls.find((c) => {
      const msg = c[1] as string | undefined;
      return typeof msg === "string" && msg.startsWith("daily-run skipped");
    });
    expect(call).toBeDefined();
  });

  // REQ-073: no enabled rows ⇒ nothing to collect ⇒ skip.
  it("logs a warning and skips when the tenant has no enabled source rows", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo: makeSourcesRepo([
        makeSourceRow("hn", { sinceDays: 1 }, false),
      ]),
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    const call = mockLoggerWarn.mock.calls.find((c) => {
      const msg = c[1] as string | undefined;
      return typeof msg === "string" && msg.startsWith("daily-run skipped");
    });
    expect(call).toBeDefined();
  });

  // REQ-066: the jitter window is parsed once at composition; the handler
  // injects the global Math.random into computeJitterMs at the call site.
  it("REQ-066: passes a jittered startDelayMs through to startRun", async () => {
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };
      mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

      const worker = createDailyRunWorker({
        userSettingsRepo,
        sourcesRepo: makeSourcesRepo([hnRow()]),
        redis: { fake: "redis" } as never,
        queue: { add: vi.fn() } as never,
        startJitterMs: 1000,
      });

      await worker.handler(baseJob);

      const [, , , optsArg] = mockStartRun.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        { tenantId: string; startDelayMs: number },
      ];
      expect(optsArg.startDelayMs).toBe(500);
    } finally {
      randSpy.mockRestore();
    }
  });

  it("REQ-066: startJitterMs 0 disables the delay", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };
    mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo: makeSourcesRepo([hnRow()]),
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
      startJitterMs: 0,
    });

    await worker.handler(baseJob);

    const [, , , optsArg] = mockStartRun.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { startDelayMs: number },
    ];
    expect(optsArg.startDelayMs).toBe(0);
  });

  it("noops when job.name is not 'daily-run'", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };
    const worker = createDailyRunWorker({
      userSettingsRepo,
      sourcesRepo: makeSourcesRepo([hnRow()]),
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler({ name: "run-process", id: "x", data: {} });

    expect(userSettingsRepo.get).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });
});
