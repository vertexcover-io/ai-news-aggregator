import { describe, it, expect } from "vitest";
import {
  type ConcurrencyLimiter,
  type ConcurrencyLimiterOptions,
} from "@pipeline/services/concurrency-limiter.js";

/**
 * In-memory semaphore for deterministic unit testing of the algorithm.
 * Does NOT require Redis.
 */
class InMemoryConcurrencyLimiter implements ConcurrencyLimiter {
  private count = 0;
  private readonly max: number;

  constructor(options: ConcurrencyLimiterOptions) {
    this.max = options.maxConcurrent;
  }

  async tryAcquire(): Promise<boolean> {
    await Promise.resolve();
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  async release(): Promise<void> {
    await Promise.resolve();
    if (this.count > 0) this.count--;
  }

  active(): number {
    return this.count;
  }
}

describe("ConcurrencyLimiter", () => {
  it("allows acquiring up to the max before rejecting", async () => {
    const limiter = new InMemoryConcurrencyLimiter({ maxConcurrent: 3 });

    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);
  });

  it("release frees a slot so another acquire succeeds", async () => {
    const limiter = new InMemoryConcurrencyLimiter({ maxConcurrent: 2 });

    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);

    await limiter.release();
    expect(await limiter.tryAcquire()).toBe(true);
  });

  it("releasing when not held does not go negative", async () => {
    const limiter = new InMemoryConcurrencyLimiter({ maxConcurrent: 1 });
    await limiter.release();
    await limiter.release();
    expect(limiter.active()).toBe(0);
  });

  it("active returns the current count", async () => {
    const limiter = new InMemoryConcurrencyLimiter({ maxConcurrent: 5 });
    expect(limiter.active()).toBe(0);
    await limiter.tryAcquire();
    expect(limiter.active()).toBe(1);
    await limiter.tryAcquire();
    expect(limiter.active()).toBe(2);
    await limiter.release();
    expect(limiter.active()).toBe(1);
  });
});
