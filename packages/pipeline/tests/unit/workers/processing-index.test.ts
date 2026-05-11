import { describe, it, expect, vi } from "vitest";

// Set required env vars before module-level guards in src/index.ts execute.
// vi.hoisted runs before any imports are resolved in ESM, so these values are
// available when index.ts runs its ANTHROPIC_API_KEY / SESSION_SECRET checks.
vi.hoisted(() => {
  // ??= cannot be used here: Vitest's hoisting transform does not support the
  // LogicalAssignment proposal, so we use the equivalent if-assignment form.
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = "test-key"; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = "test-secret"; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
});

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
vi.mock("crawlee", () => ({
  Configuration: {
    getGlobalConfig: vi.fn(() => ({ set: vi.fn() })),
  },
}));
vi.mock("@pipeline/lib/boot.js", () => ({
  assertChromiumInstalled: vi.fn(),
}));
vi.mock("@pipeline/workers/collection.js", () => ({
  collectionWorker: { on: vi.fn(), close: vi.fn() },
}));
vi.mock("@pipeline/workers/processing.js", () => ({
  createProcessingWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  buildDefaultNewsletterSendDeps: vi.fn(),
}));
vi.mock("@pipeline/services/run-state.js", () => ({
  createRunStateService: vi.fn(() => ({ setStage: vi.fn() })),
  RUN_STATE_TTL_SECONDS: 3600,
}));
vi.mock("@pipeline/workers/newsletter-send.js", () => ({
  handleNewsletterSendJob: vi.fn(),
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
