import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";

/**
 * Token-bucket rate limiter keyed by client IP.
 * Uses a simple in-memory Map for in-process rate limiting.
 * Each bucket replenishes at `maxRequests` per `windowMs`.
 *
 * ## IP resolution (trust model)
 * In production a trusted reverse proxy (nginx, Cloudflare, etc.) sets
 * `X-Forwarded-For` to the true remote address, stripping any client-supplied
 * value. We read the **leftmost** IP from that header — the original client.
 * In local dev (no proxy) or behind Bun/Deno runtimes, we fall back to the
 * raw TCP remote address from the runtime. "unknown" is only used as a
 * last-resort sentinel and will NOT bypass the rate limit (all "unknown"
 * clients share the same bucket).
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Clean up stale entries every 5 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 300_000) {
      buckets.delete(key);
    }
  }
}, 300_000).unref();

/** Resolve the remote IP from the request, preferring proxy headers. */
function resolveIp(c: Context): string {
  // Trusted reverse proxy sets X-Forwarded-For; leftmost = original client.
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const leftmost = forwarded.split(",")[0]?.trim();
    if (leftmost) return leftmost;
  }

  // X-Real-IP is set by some proxy configurations (nginx proxy_set_header).
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  // Fallback: raw TCP remote address from the runtime (honojs/getConnInfo).
  // Dynamic import to avoid a hard dependency on the hono adapter.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getConnInfo } = require("@hono/node-server") as {
      getConnInfo?: (c: Context) => { remote?: { address?: string } };
    };
    const info = getConnInfo?.(c);
    if (info?.remote?.address) return info.remote.address;
  } catch {
    // @hono/node-server not available — not a Node.js runtime.
  }

  return "unknown";
}

/**
 * Create a rate-limiting middleware.
 *
 * @param maxRequests Maximum requests allowed in the window.
 * @param windowMs Duration of the rate-limit window in milliseconds.
 * @param keyPrefix Prefix for the rate-limit key (to scope different route groups).
 */
export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
  keyPrefix: string,
): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const ip = resolveIp(c);
    const key = `${keyPrefix}:${ip}`;

    let bucket = buckets.get(key);
    const now = Date.now();

    if (!bucket) {
      bucket = { tokens: maxRequests, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time.
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / windowMs) * maxRequests;
    bucket.tokens = Math.min(maxRequests, bucket.tokens + refillAmount);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return c.json(
        {
          error: "too_many_requests",
          message: "Rate limit exceeded. Please try again later.",
        },
        429,
      );
    }

    bucket.tokens -= 1;
    await next();
  });
}
