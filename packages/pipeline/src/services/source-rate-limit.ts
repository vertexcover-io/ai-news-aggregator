/**
 * Global per-external-source token bucket for rate limiting across all tenant
 * pipeline runs (REQ-067).
 *
 * Each source (HN, Reddit, etc.) has its own bucket with maxTokens and a
 * refill rate. `tryConsume` is synchronous (no I/O) — the bucket is local
 * in-process state, which means two pipeline workers on different machines
 * will each have their own counter. For the single-box deployment this is
 * correct; for a multi-worker deployment Redis-backed buckets should replace
 * this implementation.
 *
 * Unconfigured sources always return true (no rate limit).
 */

export interface SourceBucket {
  readonly maxTokens: number;
  /** Tokens refilled per millisecond. */
  readonly refillRatePerMs: number;
}

export type SourceRateLimitConfig = Record<string, SourceBucket | undefined>;

export interface SourceRateLimiter {
  /**
   * Try to consume `count` tokens from a source's bucket.
   * Returns true if enough tokens were available, false if rate-limited.
   */
  tryConsume(source: string, count: number): boolean;

  /**
   * Get current token count for a source.
   * Returns maxTokens for unconfigured sources.
   */
  getTokens(source: string): number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export function createSourceRateLimiter(
  config: SourceRateLimitConfig,
): SourceRateLimiter {
  const state = new Map<string, BucketState>();

  const ensure = (source: string): BucketState => {
    let s = state.get(source);
    if (!s) {
      const bucket = config[source];
      const tokens = bucket?.maxTokens ?? Infinity;
      s = { tokens, lastRefill: Date.now() };
      state.set(source, s);
    }
    return s;
  };

  const refill = (s: BucketState, bucket: SourceBucket): void => {
    const now = Date.now();
    const elapsed = now - s.lastRefill;
    if (elapsed <= 0) return;
    const added = elapsed * bucket.refillRatePerMs;
    s.tokens = Math.min(s.tokens + added, bucket.maxTokens);
    s.lastRefill = now;
  };

  return {
    tryConsume(source: string, count: number): boolean {
      const bucket = config[source];
      if (!bucket) return true; // no limit configured

      const s = ensure(source);
      refill(s, bucket);

      if (s.tokens < count) return false;

      s.tokens -= count;
      return true;
    },

    getTokens(source: string): number {
      const bucket = config[source];
      if (!bucket) return Infinity;

      const s = ensure(source);
      refill(s, bucket);
      return s.tokens;
    },
  };
}
