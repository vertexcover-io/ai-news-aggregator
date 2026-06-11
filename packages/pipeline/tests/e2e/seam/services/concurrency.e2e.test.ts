import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  MAX_CONCURRENT_RUNS,
  RUN_CONCURRENCY_KEY,
  createRunConcurrencyLimiter,
} from "@pipeline/services/concurrency.js";
import {
  closeTestRedis,
  getTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

// P10 (REQ-065/EDGE-009/REQ-123): the global run-concurrency cap is a Redis
// semaphore — concurrent holders never exceed the cap, and excess acquirers
// WAIT for a slot instead of being dropped.
describe("run concurrency limiter (Redis semaphore)", () => {
  let key: string;

  beforeEach(() => {
    key = `${RUN_CONCURRENCY_KEY}:test:${randomUUID()}`;
  });

  afterEach(async () => {
    await getTestRedis().del(key);
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  interface LoadResult {
    completed: number;
    maxConcurrent: number;
  }

  async function runLoad(
    cap: number,
    totalRuns: number,
    holdMs: (i: number) => number,
  ): Promise<LoadResult> {
    const limiter = createRunConcurrencyLimiter(getTestRedis(), {
      cap,
      key,
      pollIntervalMs: 10,
    });
    let current = 0;
    let maxConcurrent = 0;
    let completed = 0;
    await Promise.all(
      Array.from({ length: totalRuns }, async (_, i) => {
        const release = await limiter.acquire(`run-${i}`);
        current += 1;
        maxConcurrent = Math.max(maxConcurrent, current);
        try {
          await delay(holdMs(i));
        } finally {
          current -= 1;
          await release();
        }
        completed += 1;
      }),
    );
    return { completed, maxConcurrent };
  }

  it("test_REQ_065_global_cap_queues_excess_runs", async () => {
    const { completed, maxConcurrent } = await runLoad(2, 6, () => 50);

    // never more than the cap held a slot simultaneously
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    // ...and the excess runs queued (waited) rather than being dropped
    expect(completed).toBe(6);
    // semaphore fully drained afterwards
    const limiter = createRunConcurrencyLimiter(getTestRedis(), { cap: 2, key });
    expect(await limiter.inUse()).toBe(0);
  });

  it("test_REQ_123_load_concurrency_within_cap", async () => {
    // load journey: 4x the cap arrives at once (deterministic varied holds)
    const cap = MAX_CONCURRENT_RUNS;
    const { completed, maxConcurrent } = await runLoad(
      cap,
      cap * 4,
      (i) => 10 + (i % 4) * 10,
    );

    expect(maxConcurrent).toBeLessThanOrEqual(cap);
    expect(completed).toBe(cap * 4);
  });

  it("test_EDGE_009_cap_queues_jitter_completes", async () => {
    // popular schedule time: 5 tenants start jitter-spread within a window
    // while the cap is 2 — every run still completes, none dropped.
    const starts = [0, 5, 10, 15, 20];
    const limiter = createRunConcurrencyLimiter(getTestRedis(), {
      cap: 2,
      key,
      pollIntervalMs: 10,
    });
    let current = 0;
    let maxConcurrent = 0;
    const completedRuns: string[] = [];
    await Promise.all(
      starts.map(async (startDelayMs, i) => {
        await delay(startDelayMs);
        const release = await limiter.acquire(`tenant-${i}`);
        current += 1;
        maxConcurrent = Math.max(maxConcurrent, current);
        try {
          await delay(40);
        } finally {
          current -= 1;
          await release();
        }
        completedRuns.push(`tenant-${i}`);
      }),
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(completedRuns).toHaveLength(5);
  });

  it("expires a crashed holder's lease so the slot frees without release()", async () => {
    const limiter = createRunConcurrencyLimiter(getTestRedis(), {
      cap: 1,
      key,
      pollIntervalMs: 10,
      leaseMs: 80,
    });
    // first holder "crashes" — never releases
    await limiter.acquire("crashed-run");

    // second acquire must succeed once the lease expires
    const startedAt = Date.now();
    const release = await limiter.acquire("next-run");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
    await release();
  });

  it("release is idempotent and frees the slot immediately", async () => {
    const limiter = createRunConcurrencyLimiter(getTestRedis(), {
      cap: 1,
      key,
      pollIntervalMs: 5,
    });
    const release = await limiter.acquire("a");
    await release();
    await release();

    const releaseB = await limiter.acquire("b");
    expect(await limiter.inUse()).toBe(1);
    await releaseB();
    expect(await limiter.inUse()).toBe(0);
  });
});
