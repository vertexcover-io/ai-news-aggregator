/**
 * In-memory token-bucket rate limiter keyed by client IP (REQ-121).
 * Applied to the auth routes (signup/login/forgot/reset). Single-process
 * only — fine for this deployment shape; swap for Redis if the API is ever
 * horizontally scaled.
 */
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";

export interface RateLimiterOptions {
  /** Maximum burst size (bucket capacity). */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
  /** Clock override for tests (ms). */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const MAX_TRACKED_IPS = 10_000;

export function createRateLimiter(opts: RateLimiterOptions): MiddlewareHandler {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return createMiddleware(async (c, next) => {
    // Key on the LAST x-forwarded-for hop: the trusted proxy APPENDS the
    // real peer ip, so every earlier entry is client-forgeable — keying on
    // the first hop would let an attacker mint a fresh bucket per request.
    const forwarded = c.req.header("x-forwarded-for");
    const hops = forwarded
      ?.split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const ip =
      hops?.[hops.length - 1] ??
      c.req.header("x-real-ip") ??
      "unknown";

    const t = now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      // Bound memory: drop the whole map if an attacker rotates IPs.
      if (buckets.size >= MAX_TRACKED_IPS) buckets.clear();
      bucket = { tokens: opts.capacity, lastRefillMs: t };
      buckets.set(ip, bucket);
    } else {
      const elapsedSec = Math.max(0, t - bucket.lastRefillMs) / 1000;
      bucket.tokens = Math.min(
        opts.capacity,
        bucket.tokens + elapsedSec * opts.refillPerSecond,
      );
      bucket.lastRefillMs = t;
    }

    if (bucket.tokens < 1) {
      return c.json({ error: "rate_limited" }, 429);
    }
    bucket.tokens -= 1;
    await next();
  });
}
