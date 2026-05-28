import { describe, it, expect, vi } from "vitest";

// Mock modules that create workers and Redis connections at module-load time
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockReturnValue({ on: vi.fn(), close: vi.fn() }),
  Queue: vi.fn().mockReturnValue({ add: vi.fn(), close: vi.fn() }),
}));
vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({})),
}));
vi.mock("@newsletter/shared", () => ({
  getDb: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));
vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));
vi.mock("@pipeline/workers/collection.js", () => ({
  collectionWorker: { on: vi.fn(), close: vi.fn() },
}));
vi.mock("@pipeline/workers/processing.js", () => ({
  createProcessingWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));
vi.mock("@pipeline/services/run-state.js", () => ({
  createRunStateService: vi.fn(() => ({ setStage: vi.fn() })),
  RUN_STATE_TTL_SECONDS: 3600,
}));
vi.mock("@pipeline/lib/boot.js", () => ({
  assertChromiumInstalled: vi.fn(),
}));

import { getRunIdFromJobData } from "../../../src/index.js";

describe("getRunIdFromJobData", () => {
  it("returns runId string when present", () => {
    expect(getRunIdFromJobData({ runId: "abc-123" })).toBe("abc-123");
  });

  it("returns undefined when runId is missing", () => {
    expect(getRunIdFromJobData({ other: "value" })).toBeUndefined();
  });

  it("returns undefined when runId is not a string", () => {
    expect(getRunIdFromJobData({ runId: 123 })).toBeUndefined();
    expect(getRunIdFromJobData({ runId: null })).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    expect(getRunIdFromJobData(null)).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(getRunIdFromJobData("string")).toBeUndefined();
    expect(getRunIdFromJobData(42)).toBeUndefined();
  });
});
