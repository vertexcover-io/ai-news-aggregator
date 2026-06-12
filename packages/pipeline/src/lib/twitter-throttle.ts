import {
  createRedisThrottle,
  type RedisThrottle,
  type ThrottleRedis,
} from "@newsletter/shared/services";

// REQ-068: one global budget for the shared Twitter (rettiwt) collector —
// the key is NOT tenant-scoped on purpose: every tenant's run draws from it.
export const TWITTER_COLLECTOR_THROTTLE_KEY = "throttle:twitter-collector";

export const DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND = 1;

/** TWITTER_COLLECTOR_RATE_PER_SECOND env: default 1 fetch/sec; <= 0 disables; junk falls back to the default. */
export function parseTwitterCollectorRate(value: string | undefined): number {
  if (value === undefined || value === "") {
    return DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND;
  return parsed;
}

export function createTwitterCollectorThrottle(
  redis: ThrottleRedis,
  env: NodeJS.ProcessEnv = process.env,
): RedisThrottle {
  return createRedisThrottle({
    redis,
    key: TWITTER_COLLECTOR_THROTTLE_KEY,
    ratePerSecond: parseTwitterCollectorRate(env.TWITTER_COLLECTOR_RATE_PER_SECOND),
  });
}
