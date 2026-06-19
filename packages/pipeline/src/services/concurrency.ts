import type IORedis from "ioredis";

/**
 * Global pipeline-run concurrency cap (P10, REQ-065/EDGE-009/REQ-123).
 *
 * Safe single-box maximum for SIMULTANEOUS full pipeline runs: each run fans
 * out 5 collectors plus LLM shortlist/rank calls, so this is deliberately
 * small. Excess runs WAIT for a slot (they are queued, never dropped) — the
 * semaphore is Redis-backed so the cap holds across worker processes/boxes.
 */
export const MAX_CONCURRENT_RUNS = 3;

/** Redis key holding the semaphore (a ZSET of holder → lease-expiry score). */
export const RUN_CONCURRENCY_KEY = "max-concurrent-runs";

/**
 * BullMQ worker concurrency for the processing queue. Must stay ABOVE
 * MAX_CONCURRENT_RUNS so capped runs can actually execute in parallel, with
 * headroom for the other job types the worker dispatches (publish, health) —
 * never collapse this to 1 (see queue-concurrency-vs-in-process-pacer rule).
 */
export const PROCESSING_WORKER_CONCURRENCY = MAX_CONCURRENT_RUNS + 2;

const DEFAULT_LEASE_MS = 45 * 60 * 1000; // generous: full runs take minutes, not hours
const DEFAULT_POLL_INTERVAL_MS = 1000;

// Atomic check-and-acquire: drop expired leases, then admit the holder iff
// it already holds a slot (lease renew) or the cap has room.
// KEYS[1]=zset  ARGV[1]=nowMs  ARGV[2]=leaseExpiryMs  ARGV[3]=holderId  ARGV[4]=cap
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  return 1
end
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[4]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  return 1
end
return 0
`;

export type ConcurrencyRedis = Pick<
  IORedis,
  "eval" | "zrem" | "zcard" | "zremrangebyscore"
>;

export interface RunConcurrencyOptions {
  /** Max simultaneous holders. Defaults to MAX_CONCURRENT_RUNS. */
  cap?: number;
  /** Semaphore key. Defaults to RUN_CONCURRENCY_KEY. */
  key?: string;
  /** Lease TTL — a crashed holder's slot frees after this. */
  leaseMs?: number;
  /** Delay between acquire retries while the cap is saturated. */
  pollIntervalMs?: number;
  now?: () => number;
}

export type ReleaseRunSlot = () => Promise<void>;

export interface RunConcurrencyLimiter {
  /**
   * Waits until a slot is free, then holds it for `holderId`. Resolves with
   * the release function. Excess callers queue here (REQ-065) — acquisition
   * never rejects because the cap is reached.
   */
  acquire(holderId: string): Promise<ReleaseRunSlot>;
  /** Currently-held (non-expired) slot count. */
  inUse(): Promise<number>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export function createRunConcurrencyLimiter(
  redis: ConcurrencyRedis,
  options: RunConcurrencyOptions = {},
): RunConcurrencyLimiter {
  const cap = options.cap ?? MAX_CONCURRENT_RUNS;
  const key = options.key ?? RUN_CONCURRENCY_KEY;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;

  async function tryAcquire(holderId: string): Promise<boolean> {
    const nowMs = now();
    const granted = await redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      String(nowMs),
      String(nowMs + leaseMs),
      holderId,
      String(cap),
    );
    return granted === 1;
  }

  return {
    async acquire(holderId: string): Promise<ReleaseRunSlot> {
      // Bounded only by slot availability: waiters poll until admitted.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        if (await tryAcquire(holderId)) {
          return async (): Promise<void> => {
            await redis.zrem(key, holderId);
          };
        }
        await delay(pollIntervalMs);
      }
    },
    async inUse(): Promise<number> {
      await redis.zremrangebyscore(key, "-inf", now());
      return redis.zcard(key);
    },
  };
}
