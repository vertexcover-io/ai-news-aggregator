import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserSettings } from "@newsletter/shared";

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
    hnConfig: { limit: 10, minPoints: 5, type: "top" },
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
  };
}

interface JobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

const baseJob: JobLike = { name: "pipeline-run", id: "job-1", data: {} };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDailyRunWorker", () => {
  it("calls startRun with settings when a pipeline-run job fires and sources are enabled", async () => {
    const settings = makeSettings();
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(settings)) };
    mockStartRun.mockResolvedValueOnce({ runId: "new-run" });

    const worker = createDailyRunWorker({
      userSettingsRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(userSettingsRepo.get).toHaveBeenCalledOnce();
    expect(mockStartRun).toHaveBeenCalledOnce();
    const [settingsArg, depsArg] = mockStartRun.mock.calls[0] as [
      UserSettings,
      { redis: unknown; queue: unknown },
    ];
    expect(settingsArg).toBe(settings);
    expect(depsArg.redis).toEqual({ fake: "redis" });
    expect(depsArg.queue).toBeDefined();
  });

  it("logs a warning and skips when user_settings is missing", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(null)) };

    const worker = createDailyRunWorker({
      userSettingsRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    const call = mockLoggerWarn.mock.calls.find((c) => {
      const msg = c[1] as string | undefined;
      return typeof msg === "string" && msg.startsWith("pipeline-run skipped");
    });
    expect(call).toBeDefined();
  });

  it("logs a warning and skips when all source toggles are disabled", async () => {
    const settings = makeSettings({
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
      twitterConfig: null,
      });
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(settings)) };

    const worker = createDailyRunWorker({
      userSettingsRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler(baseJob);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    const call = mockLoggerWarn.mock.calls.find((c) => {
      const msg = c[1] as string | undefined;
      return typeof msg === "string" && msg.startsWith("pipeline-run skipped");
    });
    expect(call).toBeDefined();
  });

  it("noops when job.name is not 'pipeline-run'", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };
    const worker = createDailyRunWorker({
      userSettingsRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler({ name: "run-process", id: "x", data: {} });

    expect(userSettingsRepo.get).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("noops on the retired 'daily-run' job name", async () => {
    const userSettingsRepo = { get: vi.fn(() => Promise.resolve(makeSettings())) };
    const worker = createDailyRunWorker({
      userSettingsRepo,
      redis: { fake: "redis" } as never,
      queue: { add: vi.fn() } as never,
    });

    await worker.handler({ name: "daily-run", id: "legacy", data: {} });

    expect(userSettingsRepo.get).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });
});
