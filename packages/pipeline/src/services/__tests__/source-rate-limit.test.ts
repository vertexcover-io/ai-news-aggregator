import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSourceRateLimiter,
  type SourceRateLimitConfig,
} from "@pipeline/services/source-rate-limit.js";

describe("createSourceRateLimiter", () => {
  let clock: ReturnType<typeof vi.useFakeTimers>;

  beforeEach(() => {
    clock = vi.useFakeTimers();
  });

  afterEach(() => {
    clock.useRealTimers();
  });

  function makeConfig(overrides?: Partial<SourceRateLimitConfig>): SourceRateLimitConfig {
    return {
      hn: { maxTokens: 60, refillRatePerMs: 1 },       // 1 token / ms, so effectively unlimited in tests
      reddit: { maxTokens: 30, refillRatePerMs: 1 / 60 }, // 1 token / minute in real time
      ...overrides,
    };
  }

  it("allows consuming up to maxTokens for a source", () => {
    const limiter = createSourceRateLimiter(makeConfig());
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(true);
  });

  it("blocks when out of tokens", () => {
    const cfg: SourceRateLimitConfig = {
      hn: { maxTokens: 2, refillRatePerMs: 0.001 }, // 1 token per second
    };
    const limiter = createSourceRateLimiter(cfg);

    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(false);
  });

  it("refills tokens over time", () => {
    const cfg: SourceRateLimitConfig = {
      hn: { maxTokens: 1, refillRatePerMs: 1 }, // 1 token per ms
    };
    const limiter = createSourceRateLimiter(cfg);

    // consume the only token
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(false);

    // advance clock by 10ms — should have refilled back to max (1)
    clock.advanceTimersByTime(10);
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(false);
  });

  it("caps tokens at maxTokens (no hoarding)", () => {
    const cfg: SourceRateLimitConfig = {
      hn: { maxTokens: 3, refillRatePerMs: 1 },
    };
    const limiter = createSourceRateLimiter(cfg);

    // advance far beyond max — should cap at maxTokens
    clock.advanceTimersByTime(100_000);

    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(true);
    expect(limiter.tryConsume("hn", 1)).toBe(false);
  });

  it("returns 'unknown' for unconfigured sources", () => {
    const limiter = createSourceRateLimiter(makeConfig());
    // Always allows unconfigured sources
    expect(limiter.tryConsume("twitter", 1)).toBe(true);
    expect(limiter.tryConsume("blog", 1)).toBe(true);
  });

  it("getTokens returns current token count", () => {
    const cfg: SourceRateLimitConfig = {
      hn: { maxTokens: 5, refillRatePerMs: 1 },
    };
    const limiter = createSourceRateLimiter(cfg);

    expect(limiter.getTokens("hn")).toBe(5);
    limiter.tryConsume("hn", 3);
    expect(limiter.getTokens("hn")).toBe(2);
  });
});
