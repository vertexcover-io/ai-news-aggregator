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
vi.mock("@pipeline/workers/collector-health.js", () => ({
  createCollectorHealthWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));
vi.mock("@pipeline/services/run-state.js", () => ({
  createRunStateService: vi.fn(() => ({ setStage: vi.fn() })),
  RUN_STATE_TTL_SECONDS: 3600,
}));
vi.mock("@pipeline/lib/boot.js", () => ({
  assertChromiumInstalled: vi.fn(),
}));
// index.ts primes the single-tenant bridge scope at startup (P4 write-side);
// the unit test has no DB, so stub the resolver like the other boot effects.
vi.mock("@pipeline/repositories/default-tenant.js", () => ({
  primeDefaultTenantScope: vi.fn(() =>
    Promise.resolve({ tenantId: "00000000-0000-0000-0000-0000000000aa", role: "tenant_admin" }),
  ),
  getDefaultTenantScope: vi.fn(() => undefined),
}));

import { getRunIdFromJobData } from "../../../src/index.js";

describe("getRunIdFromJobData", () => {
  it.each<{ name: string; input: unknown; expected: string | undefined }>([
    { name: "runId string is present", input: { runId: "abc-123" }, expected: "abc-123" },
    { name: "runId is missing", input: { other: "value" }, expected: undefined },
    { name: "runId is a number", input: { runId: 123 }, expected: undefined },
    { name: "runId is null", input: { runId: null }, expected: undefined },
    { name: "input is null", input: null, expected: undefined },
    { name: "input is a string", input: "string", expected: undefined },
    { name: "input is a number", input: 42, expected: undefined },
  ])("returns $expected when $name", ({ input, expected }) => {
    expect(getRunIdFromJobData(input)).toBe(expected);
  });
});
