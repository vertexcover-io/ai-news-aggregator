import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAuthRouter } from "@api/routes/auth.js";
import { createRateLimiter } from "@api/auth/rate-limit.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { User, Tenant } from "@newsletter/shared";

const SESSION_SECRET = "test-session-secret-with-at-least-32-bytes-long!";

async function hashPassword(plaintext: string): Promise<string> {
  return `fake_argon2id_${plaintext}`;
}

async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return hash === `fake_argon2id_${plaintext}`;
}

function makeUsersRepo(): UsersRepo {
  return {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    create: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
}

function makeTenantsRepo(): TenantsRepo {
  return {
    findById: vi.fn(async () => null),
    findBySlug: vi.fn(async () => null),
    create: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
}

describe("rate limiting on auth routes (REQ-121)", () => {
  it("test_REQ_121_blocks_after_threshold", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const authRouter = createAuthRouter({
      usersRepo: makeUsersRepo(),
      tenantsRepo: makeTenantsRepo(),
      sessionSecret: SESSION_SECRET,
      logger,
      hashPassword,
      verifyPassword,
    });

    // Mount with rate limiter at 5 reqs per 60s
    const authApp = new Hono();
    authApp.use("*", createRateLimiter(5, 60_000, "auth"));
    authApp.route("/", authRouter);

    const app = new Hono();
    app.route("/api/auth", authApp);

    const payload = { email: "test@example.com", password: "anything" };

    // Send up to 5 requests (should all be allowed since they go to different test endpoints or same login)
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "192.168.1.1",
        },
        body: JSON.stringify(payload),
      });
      lastStatus = res.status;
    }

    // 6th request should be rate-limited
    expect(lastStatus).toBe(429);
    const body = (await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.1.1",
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json())) as Record<string, unknown>;
    expect(body.error).toBe("too_many_requests");
  });

  it("different IPs get separate rate limits", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const authRouter = createAuthRouter({
      usersRepo: makeUsersRepo(),
      tenantsRepo: makeTenantsRepo(),
      sessionSecret: SESSION_SECRET,
      logger,
      hashPassword,
      verifyPassword,
    });

    const authApp = new Hono();
    authApp.use("*", createRateLimiter(5, 60_000, "auth"));
    authApp.route("/", authRouter);

    const app = new Hono();
    app.route("/api/auth", authApp);

    const payload = { email: "test@example.com", password: "anything" };

    // Exhaust rate limit for IP1
    for (let i = 0; i < 6; i++) {
      await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "192.168.1.1",
        },
        body: JSON.stringify(payload),
      });
    }

    // IP2 should still be allowed (first 5 requests)
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.2.1",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(401); // Not 429 — different IP
  });
});
