import type { MiddlewareHandler } from "hono";
import type { Redis } from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";

export interface RateLimitOptions {
  /** Max requests allowed per window per IP. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Key prefix for the Redis counter (e.g. "ratelimit:auth"). */
  prefix?: string;
  /** Override the Redis client (tests inject a fake). */
  redis?: Pick<Redis, "incr" | "pexpire">;
}

function clientIp(headerLookup: (name: string) => string | undefined): string {
  const forwarded = headerLookup("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headerLookup("x-real-ip") ?? "unknown";
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const prefix = options.prefix ?? "ratelimit:auth";
  let client: Pick<Redis, "incr" | "pexpire"> | undefined = options.redis;

  const getClient = (): Pick<Redis, "incr" | "pexpire"> => {
    client ??= createRedisConnection();
    return client;
  };

  return async (c, next) => {
    const ip = clientIp((name) => c.req.header(name));
    const key = `${prefix}:${ip}`;
    const redis = getClient();

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, options.windowMs);
    }

    if (count > options.limit) {
      return c.json({ error: "rate_limited" }, 429);
    }

    return next();
  };
}
