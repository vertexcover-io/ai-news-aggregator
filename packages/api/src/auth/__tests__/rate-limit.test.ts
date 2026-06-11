import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createRateLimiter } from "../rate-limit.js";

function buildApp(opts: {
  capacity: number;
  refillPerSecond: number;
  now: () => number;
}): Hono {
  const app = new Hono();
  app.use("*", createRateLimiter(opts));
  app.post("/login", (c) => c.json({ ok: true }));
  return app;
}

async function post(app: Hono, ip: string): Promise<Response> {
  return app.request("/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("auth rate limiter (REQ-121)", () => {
  it("test_REQ_121_rate_limit_throttles_excess_attempts", async () => {
    let t = 0;
    const app = buildApp({ capacity: 3, refillPerSecond: 1, now: () => t });
    for (let i = 0; i < 3; i++) {
      const res = await post(app, "1.2.3.4");
      expect(res.status).toBe(200);
    }
    const blocked = await post(app, "1.2.3.4");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    // Refill: after 1 second one token is back.
    t += 1000;
    const after = await post(app, "1.2.3.4");
    expect(after.status).toBe(200);
  });

  it("buckets are keyed per IP", async () => {
    const app = buildApp({ capacity: 1, refillPerSecond: 0, now: () => 0 });
    expect((await post(app, "1.1.1.1")).status).toBe(200);
    expect((await post(app, "1.1.1.1")).status).toBe(429);
    expect((await post(app, "2.2.2.2")).status).toBe(200);
  });

  it("keys on the LAST x-forwarded-for hop — a client-forged first hop cannot mint fresh buckets", async () => {
    const app = buildApp({ capacity: 1, refillPerSecond: 0, now: () => 0 });
    // The proxy APPENDS the real peer ip; everything before it is
    // client-controlled. Rotating the forged prefix must not escape the
    // limit.
    const res1 = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "6.6.6.1, 9.9.9.9" },
    });
    expect(res1.status).toBe(200);
    const res2 = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "6.6.6.2, 9.9.9.9" },
    });
    expect(res2.status).toBe(429);
  });
});
