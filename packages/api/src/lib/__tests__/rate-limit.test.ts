import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createRateLimiter, type RateLimitRedis } from "../rate-limit.js";

function makeFakeRedis(): RateLimitRedis & {
  counts: Map<string, number>;
  expires: Map<string, number>;
} {
  const counts = new Map<string, number>();
  const expires = new Map<string, number>();
  return {
    counts,
    expires,
    incr(key: string): Promise<number> {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    expire(key: string, seconds: number): Promise<number> {
      expires.set(key, seconds);
      return Promise.resolve(1);
    },
  };
}

function makeApp(
  redis: RateLimitRedis,
  max: number,
  trustProxyHops?: number,
): Hono {
  const app = new Hono();
  app.use(
    "/login",
    createRateLimiter({ redis, windowSeconds: 900, max, prefix: "rl", trustProxyHops }),
  );
  app.post("/login", (c) => c.json({ ok: true }));
  return app;
}

async function post(app: Hono, ip: string): Promise<Response> {
  return app.request("/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("createRateLimiter (REQ-121 / NF2)", () => {
  it("allows requests under the limit", async () => {
    const app = makeApp(makeFakeRedis(), 3);
    for (let i = 0; i < 3; i++) {
      const res = await post(app, "1.2.3.4");
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 once the limit is exceeded", async () => {
    const app = makeApp(makeFakeRedis(), 2);
    await post(app, "1.2.3.4");
    await post(app, "1.2.3.4");
    const res = await post(app, "1.2.3.4");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("ignores x-forwarded-for by default — rotating the header cannot reset the bucket", async () => {
    const redis = makeFakeRedis();
    const app = makeApp(redis, 2);
    await post(app, "1.1.1.1");
    await post(app, "2.2.2.2");
    const res = await post(app, "3.3.3.3");
    expect(res.status).toBe(429);
    // No conninfo in app.request(), so everything lands in the fallback bucket.
    expect([...redis.counts.keys()]).toEqual(["rl:/login:unknown"]);
  });

  it("with trustProxyHops=1, tracks ips independently and keys by prefix:route:ip", async () => {
    const redis = makeFakeRedis();
    const app = makeApp(redis, 1, 1);
    await post(app, "1.2.3.4");
    const res = await post(app, "5.6.7.8");
    expect(res.status).toBe(200);
    expect([...redis.counts.keys()].sort()).toEqual([
      "rl:/login:1.2.3.4",
      "rl:/login:5.6.7.8",
    ]);
  });

  it("with trustProxyHops=1, uses the rightmost (proxy-appended) hop, not the spoofable leftmost", async () => {
    const redis = makeFakeRedis();
    const app = makeApp(redis, 5, 1);
    await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    expect(redis.counts.has("rl:/login:10.0.0.1")).toBe(true);
    expect(redis.counts.has("rl:/login:9.9.9.9")).toBe(false);
  });

  it("falls back to the connection address when XFF has fewer entries than trusted hops", async () => {
    const redis = makeFakeRedis();
    const app = makeApp(redis, 5, 3);
    await post(app, "9.9.9.9, 10.0.0.1");
    expect([...redis.counts.keys()]).toEqual(["rl:/login:unknown"]);
  });

  it("sets the window expiry on the first hit only", async () => {
    const redis = makeFakeRedis();
    const app = makeApp(redis, 5, 1);
    await post(app, "1.2.3.4");
    await post(app, "1.2.3.4");
    expect(redis.expires.get("rl:/login:1.2.3.4")).toBe(900);
    expect(redis.expires.size).toBe(1);
  });
});
