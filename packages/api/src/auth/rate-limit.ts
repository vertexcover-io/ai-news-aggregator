import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const MAX_TOKENS = 10;
const REFILL_RATE = 1; // tokens per second
const BUCKETS = new Map<string, Bucket>();

// Clean up stale buckets every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for") ??
    c.req.header("x-real-ip") ??
    "127.0.0.1"
  ).split(",")[0].trim();
}

function refillBucket(bucket: Bucket, now: number): void {
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + elapsed * REFILL_RATE);
  bucket.lastRefill = now;
}

function cleanupStale(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of BUCKETS) {
    if (now - bucket.lastRefill > CLEANUP_INTERVAL * 2) {
      BUCKETS.delete(key);
    }
  }
}

export function rateLimitAuth() {
  return createMiddleware(async (c, next) => {
    const now = Date.now();
    cleanupStale(now);

    const ip = getClientIp(c);
    const key = `auth:${ip}`;

    let bucket = BUCKETS.get(key);
    if (!bucket) {
      bucket = { tokens: MAX_TOKENS, lastRefill: now };
      BUCKETS.set(key, bucket);
    }

    refillBucket(bucket, now);

    if (bucket.tokens < 1) {
      // Add a small delay to slow down brute force
      await new Promise((resolve) => setTimeout(resolve, 500));
      bucket.tokens = 0; // Still deny after delay
      return c.json(
        { error: "too_many_requests", message: "Rate limit exceeded. Please try again later." },
        429,
      );
    }

    bucket.tokens -= 1;
    await next();
  });
}

/**
 * Clear all rate-limit buckets. For testing only.
 */
export function __dangerouslyClearBuckets(): void {
  BUCKETS.clear();
}
