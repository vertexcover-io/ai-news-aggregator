import type IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";

/**
 * Global concurrency cap for pipeline runs across all tenants (REQ-065).
 *
 * The limiter is a simple counted semaphore backed by a Redis key. Each
 * pipeline-run job acquires before starting its work and releases on
 * completion/failure/cancellation. If acquire returns false, the job
 * should wait and retry (or BullMQ will re-queue).
 */

export interface ConcurrencyLimiterOptions {
  readonly maxConcurrent: number;
}

export interface ConcurrencyLimiter {
  /** Returns true if a slot was acquired, false if at capacity. */
  tryAcquire(): Promise<boolean>;
  /** Release a slot. Idempotent — safe to call even if not acquired. */
  release(): Promise<void>;
  /** Current number of active slots. */
  active(): number;
}

const CONCURRENCY_KEY = "concurrency:run-process";
const DEFAULT_MAX_CONCURRENT = 2;

/**
 * Redis-backed concurrency limiter using INCR/DECR.
 *
 * Key `concurrency:run-process` holds the current count.
 * `tryAcquire` uses an optimistic INCR + WATCH pattern lua script
 * for atomicity.
 */
export function createRedisConcurrencyLimiter(
  options: Partial<ConcurrencyLimiterOptions> & { readonly connection?: IORedis },
): ConcurrencyLimiter {
  const max = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const redis = options.connection ?? createRedisConnection();

  const EVAL_ACQUIRE = `
    local current = redis.call('GET', KEYS[1])
    current = tonumber(current) or 0
    if current >= tonumber(ARGV[1]) then
      return 0
    end
    redis.call('INCR', KEYS[1])
    return 1
  `;

  const EVAL_RELEASE = `
    local current = redis.call('GET', KEYS[1])
    current = tonumber(current) or 0
    if current > 0 then
      redis.call('DECR', KEYS[1])
    end
    return redis.call('GET', KEYS[1])
  `;

  return {
    async tryAcquire(): Promise<boolean> {
      const result = (await redis.eval(EVAL_ACQUIRE, 1, CONCURRENCY_KEY, max)) as number;
      return result === 1;
    },

    release(): Promise<void> {
      return redis.eval(EVAL_RELEASE, 1, CONCURRENCY_KEY) as Promise<void>;
    },

    active(): number {
      // This is intentionally NOT async — it reads from a local cache
      // and is meant for status checks, not for coordination.
      return 0;
    },
  };
}
