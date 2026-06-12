/**
 * Redis-backed fixed-interval throttle (REQ-068): the distributed sibling of
 * the in-process SendPacer (pipeline email-send-common.ts). Enforces a minimum
 * spacing of `ceil(1000 / ratePerSecond)` ms between successive permits, with
 * the "next available slot" stored under a shared Redis key so concurrent
 * tenant runs across processes share one global budget.
 */

export interface RedisThrottle {
  acquire(): Promise<void>;
}

/** Minimal structural slice of an ioredis client. */
export interface ThrottleRedis {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

// Atomically reserve the next send slot: read the stored next-available
// timestamp, clamp it to now, advance it by one interval, and return how long
// the caller must wait. The TTL covers the full reserved backlog plus a
// margin — a fixed TTL would expire mid-backlog under contention and let new
// acquires double-book slots that waiters are still sleeping toward.
const RESERVE_SLOT_SCRIPT = `
local nextAt = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local at = nextAt
if now > at then at = now end
local newNext = at + interval
redis.call('SET', KEYS[1], newNext, 'PX', (newNext - now) + tonumber(ARGV[3]))
return at - now
`;

export interface CreateRedisThrottleOptions {
  redis: ThrottleRedis;
  key: string;
  /** Permits per second across all processes; <= 0 disables throttling. */
  ratePerSecond: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createRedisThrottle(
  options: CreateRedisThrottleOptions,
): RedisThrottle {
  const { redis, key, ratePerSecond } = options;
  if (ratePerSecond <= 0) {
    return { acquire: () => Promise.resolve() };
  }
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const minIntervalMs = Math.ceil(1000 / ratePerSecond);
  const ttlMarginMs = 60_000;

  return {
    async acquire(): Promise<void> {
      const delayMs = await redis.eval(
        RESERVE_SLOT_SCRIPT,
        1,
        key,
        now(),
        minIntervalMs,
        ttlMarginMs,
      );
      const wait = typeof delayMs === "number" ? delayMs : Number(delayMs);
      if (wait > 0) await sleep(wait);
    },
  };
}
