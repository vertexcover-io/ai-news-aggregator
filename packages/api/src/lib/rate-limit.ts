import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface RateLimiterOptions {
  redis: RateLimitRedis;
  windowSeconds: number;
  max: number;
  prefix: string;
  /** Number of trusted reverse proxies in front of the API. 0 (default)
   * ignores X-Forwarded-For entirely — the header is client-controlled and
   * would let callers rotate buckets at will. With N trusted proxies the
   * Nth-from-the-right XFF entry is the real client address. */
  trustProxyHops?: number;
}

function clientIp(c: Context, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const entries = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const hop = entries[entries.length - trustProxyHops];
    if (hop) return hop;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createRateLimiter(opts: RateLimiterOptions): MiddlewareHandler {
  const trustProxyHops = opts.trustProxyHops ?? 0;
  return async (c, next) => {
    const key = `${opts.prefix}:${c.req.path}:${clientIp(c, trustProxyHops)}`;
    const count = await opts.redis.incr(key);
    if (count === 1) {
      await opts.redis.expire(key, opts.windowSeconds);
    }
    if (count > opts.max) {
      return c.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}
