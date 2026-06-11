import type IORedis from "ioredis";

/**
 * Global per-external-source rate limiting (P10, REQ-067/068).
 *
 * One token bucket PER EXTERNAL SOURCE, stored in Redis, shared by every
 * concurrent tenant run across all worker processes — N tenants collecting
 * from Hacker News at once draw from the SAME budget, so upstream limits are
 * honored globally rather than per run.
 */
export interface SourceRateLimitConfig {
  /** Max burst (bucket size) in tokens. */
  capacity: number;
  /** Sustained refill rate in tokens per second. */
  refillPerSecond: number;
}

/**
 * Per-source budgets. One token ≈ one upstream request burst (a collector
 * start, or a Twitter page fetch). Conservative single-digit rates — these
 * pace concurrent tenants, not a single run's internal loops.
 */
export const SOURCE_RATE_LIMITS: Readonly<Record<string, SourceRateLimitConfig>> = {
  hn: { capacity: 4, refillPerSecond: 2 },
  reddit: { capacity: 2, refillPerSecond: 0.5 },
  blog: { capacity: 4, refillPerSecond: 1 },
  // Shared Twitter collector is the most ban-prone surface (EDGE-011):
  // tightest budget — roughly one page fetch per second across ALL tenants.
  twitter: { capacity: 2, refillPerSecond: 1 },
  web_search: { capacity: 2, refillPerSecond: 0.5 },
};

export const DEFAULT_SOURCE_RATE_LIMIT: SourceRateLimitConfig = {
  capacity: 2,
  refillPerSecond: 0.5,
};

const DEFAULT_KEY_PREFIX = "source-rate";
const BUCKET_TTL_MS = 10 * 60 * 1000;
const MIN_WAIT_MS = 10;

// Atomic token-bucket take: refill by elapsed time, then either consume one
// token (returns -1) or report how long until the next token (returns ms).
// KEYS[1]=bucket  ARGV[1]=nowMs  ARGV[2]=capacity  ARGV[3]=refillPerMs  ARGV[4]=ttlMs
const TAKE_SCRIPT = `
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerMs = tonumber(ARGV[3])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
local elapsed = now - ts
if elapsed > 0 then
  tokens = math.min(capacity, tokens + elapsed * refillPerMs)
end
local result
if tokens >= 1 then
  tokens = tokens - 1
  result = -1
else
  result = math.ceil((1 - tokens) / refillPerMs)
end
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return result
`;

export type SourceRateLimitRedis = Pick<IORedis, "eval">;

export interface SourceRateLimiterOptions {
  /** Override/extend the per-source budgets (tests, env tuning). */
  limits?: Readonly<Record<string, SourceRateLimitConfig>>;
  keyPrefix?: string;
  now?: () => number;
}

export interface SourceRateLimiter {
  /** Waits until the source's global bucket grants a token. */
  acquire(source: string): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export function createSourceRateLimiter(
  redis: SourceRateLimitRedis,
  options: SourceRateLimiterOptions = {},
): SourceRateLimiter {
  const limits = options.limits ?? SOURCE_RATE_LIMITS;
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const now = options.now ?? Date.now;

  return {
    async acquire(source: string): Promise<void> {
      const config = limits[source] ?? DEFAULT_SOURCE_RATE_LIMIT;
      const key = `${keyPrefix}:${source}`;
      const refillPerMs = config.refillPerSecond / 1000;
      // Bounded by token availability: waiters sleep out the refill gap.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const result = await redis.eval(
          TAKE_SCRIPT,
          1,
          key,
          String(now()),
          String(config.capacity),
          String(refillPerMs),
          String(BUCKET_TTL_MS),
        );
        if (result === -1) return;
        const waitMs = typeof result === "number" ? result : MIN_WAIT_MS;
        await delay(Math.max(MIN_WAIT_MS, waitMs));
      }
    },
  };
}
