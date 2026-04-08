import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RunState } from "@newsletter/shared";
import {
  createRunStateService,
  RUN_STATE_TTL_SECONDS,
} from "@pipeline/services/run-state.js";

interface MockRedis {
  store: Map<string, string>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function createMockRedis(): MockRedis {
  const store = new Map<string, string>();
  const set = vi.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve("OK");
  });
  const get = vi.fn((key: string) => Promise.resolve(store.get(key) ?? null));
  return { store, set, get };
}

function baseRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    status: "running",
    stage: "queued",
    topN: 10,
    startedAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

describe("createRunStateService", () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = createMockRedis();
  });

  // REQ-030: Redis run-state service round-trip
  it("set then get round-trips all fields", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    const state = baseRunState({ topN: 25, warnings: ["warn-a"] });

    await svc.set(state);
    const loaded = await svc.get("run-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("run-1");
    expect(loaded?.topN).toBe(25);
    expect(loaded?.warnings).toEqual(["warn-a"]);
    expect(loaded?.stage).toBe("queued");
  });

  // REQ-030: TTL of 3600 seconds on every set
  it("sets TTL to 3600 seconds via EX on set", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    await svc.set(baseRunState());

    expect(RUN_STATE_TTL_SECONDS).toBe(3600);
    expect(redis.set).toHaveBeenCalledWith(
      "run:run-1",
      expect.any(String),
      "EX",
      3600,
    );
  });

  // REQ-030: updateSource creates an entry if missing
  it("updateSource creates the source entry if it doesn't exist", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    await svc.set(baseRunState());

    await svc.updateSource("run-1", "hn", { status: "running" });

    const loaded = await svc.get("run-1");
    expect(loaded?.sources.hn).toEqual({
      status: "running",
      itemsFetched: 0,
      errors: [],
    });
  });

  // REQ-031: updateSource merges without clobbering other sources
  it("updateSource merges without clobbering other source entries", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    await svc.set(
      baseRunState({
        sources: {
          reddit: { status: "completed", itemsFetched: 7, errors: [] },
        },
      }),
    );

    await svc.updateSource("run-1", "hn", {
      status: "completed",
      itemsFetched: 5,
    });

    const loaded = await svc.get("run-1");
    expect(loaded?.sources.reddit).toEqual({
      status: "completed",
      itemsFetched: 7,
      errors: [],
    });
    expect(loaded?.sources.hn).toEqual({
      status: "completed",
      itemsFetched: 5,
      errors: [],
    });
  });

  // REQ-030: update returns null when key missing
  it("update returns null when the run does not exist", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    const result = await svc.update("missing", (prev) => prev);
    expect(result).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  // REQ-032: setStage preserves other fields
  it("setStage preserves other fields while updating stage", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    await svc.set(
      baseRunState({
        topN: 15,
        warnings: ["existing-warn"],
        sources: { hn: { status: "running", itemsFetched: 0, errors: [] } },
      }),
    );

    await svc.setStage("run-1", "ranking");

    const loaded = await svc.get("run-1");
    expect(loaded?.stage).toBe("ranking");
    expect(loaded?.topN).toBe(15);
    expect(loaded?.warnings).toEqual(["existing-warn"]);
    expect(loaded?.sources.hn).toEqual({
      status: "running",
      itemsFetched: 0,
      errors: [],
    });
    expect(loaded?.status).toBe("running");
  });

  // REQ-032: setStage can override status when provided
  it("setStage updates status when status arg is provided", async () => {
    const svc = createRunStateService(redis as unknown as import("ioredis").default);
    await svc.set(baseRunState());

    await svc.setStage("run-1", "failed", "failed");
    const loaded = await svc.get("run-1");
    expect(loaded?.stage).toBe("failed");
    expect(loaded?.status).toBe("failed");
  });
});
