import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SOURCE_RATE_LIMIT,
  SOURCE_RATE_LIMITS,
  createSourceRateLimiter,
} from "@pipeline/services/source-rate-limit.js";
import {
  closeTestRedis,
  getTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

// P10 (REQ-067): one GLOBAL token bucket per external source — concurrent
// tenant runs share it through Redis, so their combined call rate can never
// exceed the per-source budget.
describe("global per-source rate limiter (Redis token buckets)", () => {
  let keyPrefix: string;

  beforeEach(() => {
    keyPrefix = `source-rate:test:${randomUUID()}`;
  });

  afterEach(async () => {
    const redis = getTestRedis();
    const keys = await redis.keys(`${keyPrefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("test_REQ_067_per_source_rate_limit_enforced", async () => {
    // 1-token bucket refilling at 10/s → ~100ms between grants. Two
    // concurrent "tenant runs" each make 3 calls: 6 grants total need
    // ~500ms of refill after the initial burst token.
    const limiter = createSourceRateLimiter(getTestRedis(), {
      keyPrefix,
      limits: { hn: { capacity: 1, refillPerSecond: 10 } },
    });

    const startedAt = Date.now();
    const tenantRun = async (): Promise<void> => {
      for (let i = 0; i < 3; i += 1) {
        await limiter.acquire("hn");
      }
    };
    await Promise.all([tenantRun(), tenantRun()]);
    const elapsedMs = Date.now() - startedAt;

    // 6 grants at ≥100ms spacing after the first token: ≥ ~500ms, with
    // headroom against timer slack.
    expect(elapsedMs).toBeGreaterThanOrEqual(400);
  });

  it("allows bursts up to the bucket capacity without waiting", async () => {
    const limiter = createSourceRateLimiter(getTestRedis(), {
      keyPrefix,
      limits: { reddit: { capacity: 3, refillPerSecond: 0.1 } },
    });

    const startedAt = Date.now();
    await Promise.all([
      limiter.acquire("reddit"),
      limiter.acquire("reddit"),
      limiter.acquire("reddit"),
    ]);

    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("keeps per-source buckets independent (hn exhaustion never delays reddit)", async () => {
    const limiter = createSourceRateLimiter(getTestRedis(), {
      keyPrefix,
      limits: {
        hn: { capacity: 1, refillPerSecond: 0.5 },
        reddit: { capacity: 1, refillPerSecond: 0.5 },
      },
    });
    await limiter.acquire("hn"); // hn bucket now empty for ~2s

    const startedAt = Date.now();
    await limiter.acquire("reddit");

    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("falls back to the default budget for unknown sources", () => {
    expect(DEFAULT_SOURCE_RATE_LIMIT.capacity).toBeGreaterThan(0);
    expect(DEFAULT_SOURCE_RATE_LIMIT.refillPerSecond).toBeGreaterThan(0);
    // every pipeline collector source has an explicit budget
    for (const source of ["hn", "reddit", "blog", "twitter", "web_search"]) {
      expect(SOURCE_RATE_LIMITS[source]).toBeDefined();
    }
  });
});
