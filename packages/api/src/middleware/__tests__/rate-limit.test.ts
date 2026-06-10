import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "../rate-limit.js";

function makeRedis(initial = 0) {
  let counter = initial;
  return {
    incr: vi.fn(() => Promise.resolve(++counter)),
    pexpire: vi.fn(() => Promise.resolve(1)),
  };
}

function makeApp(redis: ReturnType<typeof makeRedis>, opts?: { limit?: number }) {
  const app = new Hono();
  app.use(
    "/protected",
    rateLimit({
      limit: opts?.limit ?? 2,
      windowMs: 60_000,
      prefix: "ratelimit:test",
      redis,
    }),
  );
  app.post("/protected", (c) => c.json({ ok: true }));
  return app;
}

function req(app: Hono, ip = "1.2.3.4") {
  return app.request("/protected", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit middleware", () => {
  it("allows requests up to the limit", async () => {
    const redis = makeRedis();
    const app = makeApp(redis);
    expect((await req(app)).status).toBe(200);
    expect((await req(app)).status).toBe(200);
  });

  it("returns 429 once the limit is exceeded", async () => {
    const redis = makeRedis();
    const app = makeApp(redis);
    await req(app);
    await req(app);
    const res = await req(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("sets the window TTL only on the first request", async () => {
    const redis = makeRedis();
    const app = makeApp(redis);
    await req(app);
    await req(app);
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
    expect(redis.pexpire).toHaveBeenCalledWith("ratelimit:test:1.2.3.4", 60_000);
  });

  it("keys per client IP from x-forwarded-for", async () => {
    const redis = makeRedis();
    const app = makeApp(redis);
    await req(app, "9.9.9.9");
    expect(redis.incr).toHaveBeenCalledWith("ratelimit:test:9.9.9.9");
  });
});
