import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import type { RunState } from "@newsletter/shared";
import { runKey } from "@newsletter/shared";
import {
  cancelRun,
  CancelNotFoundError,
  CancelConflictError,
  type CancelRunDeps,
} from "@api/services/cancel-run.js";

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  const now = new Date().toISOString();
  return {
    id: "run-abc",
    status: "running",
    stage: "collecting",
    topN: 10,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

interface MockRedis {
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
}

function makeRedis(initial?: Record<string, string>): MockRedis {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    publish: vi.fn(() => Promise.resolve(1)),
  };
}

function makeArchiveRepo(exists: boolean) {
  return {
    findById: vi.fn(() =>
      Promise.resolve(
        exists
          ? {
              id: "run-abc",
              status: "completed" as const,
              rankedItems: [],
              topN: 10,
              profileName: null,
              reviewed: false,
              completedAt: new Date(),
              createdAt: new Date(),
            }
          : null,
      ),
    ),
    list: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.reject(new Error("n/a"))),
  };
}

function makeDeps(
  redisOpts: Parameters<typeof makeRedis>[0] = {},
  archiveExists = false,
): { deps: CancelRunDeps; redis: MockRedis } {
  const redis = makeRedis(redisOpts);
  const deps: CancelRunDeps = {
    redis: redis as unknown as IORedis,
    publisher: redis as unknown as IORedis,
    archiveRepo: makeArchiveRepo(archiveExists),
  };
  return { deps, redis };
}

describe("cancelRun — happy paths", () => {
  it("REQ-02: running → writes cancelling, publishes once, returns updated RunState", async () => {
    const runId = "run-abc";
    const state = makeRunState({ id: runId, status: "running" });
    const { deps, redis } = makeDeps({ [runKey(runId)]: JSON.stringify(state) });

    const result = await cancelRun(runId, deps);

    expect(result.status).toBe("cancelling");
    expect(result.id).toBe(runId);

    // verify Redis was updated with cancelling status
    const rawStored = redis.store.get(runKey(runId));
    if (!rawStored) throw new Error("expected redis entry to exist");
    const stored = JSON.parse(rawStored) as RunState;
    expect(stored.status).toBe("cancelling");

    // verify publish was called exactly once
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(`run:cancel:${runId}`);
  });

  it("EDGE-01: already cancelling → returns current RunState WITHOUT re-publishing (idempotent 200)", async () => {
    const runId = "run-abc";
    const state = makeRunState({ id: runId, status: "cancelling" });
    const { deps, redis } = makeDeps({ [runKey(runId)]: JSON.stringify(state) });

    const result = await cancelRun(runId, deps);

    expect(result.status).toBe("cancelling");
    expect(redis.publish).not.toHaveBeenCalled();
    // Redis set should also not be called (no state change)
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe("cancelRun — error paths", () => {
  it("REQ-03: completed → throws CancelConflictError, does NOT publish", async () => {
    const runId = "run-abc";
    const state = makeRunState({ id: runId, status: "completed" });
    const { deps, redis } = makeDeps({ [runKey(runId)]: JSON.stringify(state) });

    await expect(cancelRun(runId, deps)).rejects.toBeInstanceOf(CancelConflictError);
    expect(redis.publish).not.toHaveBeenCalled();

    // verify the error carries the current status
    try {
      await cancelRun(runId, deps);
    } catch (err) {
      expect((err as CancelConflictError).currentStatus).toBe("completed");
    }
  });

  it("REQ-03: failed → throws CancelConflictError, does NOT publish", async () => {
    const runId = "run-abc";
    const state = makeRunState({ id: runId, status: "failed" });
    const { deps, redis } = makeDeps({ [runKey(runId)]: JSON.stringify(state) });

    await expect(cancelRun(runId, deps)).rejects.toBeInstanceOf(CancelConflictError);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("REQ-03: cancelled → throws CancelConflictError, does NOT publish", async () => {
    const runId = "run-abc";
    const state = makeRunState({ id: runId, status: "cancelled" });
    const { deps, redis } = makeDeps({ [runKey(runId)]: JSON.stringify(state) });

    await expect(cancelRun(runId, deps)).rejects.toBeInstanceOf(CancelConflictError);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("REQ-04: no Redis key and no DB archive → throws CancelNotFoundError", async () => {
    const { deps } = makeDeps({}, false);

    await expect(cancelRun("no-such-run", deps)).rejects.toBeInstanceOf(
      CancelNotFoundError,
    );
  });

  it("REQ-04: no Redis key but archive exists → throws CancelConflictError (terminal)", async () => {
    // If the run is in the archive but not in Redis, it's terminal
    const { deps, redis } = makeDeps({}, true);

    await expect(cancelRun("run-abc", deps)).rejects.toBeInstanceOf(
      CancelConflictError,
    );
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
