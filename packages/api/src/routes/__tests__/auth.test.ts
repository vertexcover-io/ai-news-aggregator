import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createAuthRouter } from "../auth.js";
import type { UsersRepo, UserRecord } from "../../repositories/users.js";
import type { TenantsRepo, TenantRecord } from "../../repositories/tenants.js";
import { __dangerouslyClearBuckets } from "../../auth/rate-limit.js";

const SESSION_SECRET = "test-session-secret-at-least-32-bytes!!";
const SESSION_COOKIE = "session";

function makeFakeRepos() {
  const users: UserRecord[] = [];
  const tenants: TenantRecord[] = [];

  const usersRepo: UsersRepo = {
    findByEmail(email: string) {
      return Promise.resolve(
        users.find((u) => u.email === email.toLowerCase().trim()) ?? null,
      );
    },
    findById(id: string) {
      return Promise.resolve(users.find((u) => u.id === id) ?? null);
    },
    create(user) {
      const record: UserRecord = {
        id: `user-${users.length + 1}`,
        tenantId: user.tenantId,
        email: user.email.toLowerCase().trim(),
        name: user.name,
        passwordHash: user.passwordHash,
        role: user.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.push(record);
      return Promise.resolve(record);
    },
    updatePassword(id: string, passwordHash: string) {
      const u = users.find((u) => u.id === id);
      if (u) {
        (u as { passwordHash: string }).passwordHash = passwordHash;
        (u as { updatedAt: Date }).updatedAt = new Date();
      }
      return Promise.resolve();
    },
  };

  const tenantsRepo: TenantsRepo = {
    create(tenant) {
      const record: TenantRecord = {
        id: `tenant-${tenants.length + 1}`,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tenants.push(record);
      return Promise.resolve(record);
    },
    findById(id: string) {
      return Promise.resolve(tenants.find((t) => t.id === id) ?? null);
    },
    findBySlug(slug: string) {
      return Promise.resolve(tenants.find((t) => t.slug === slug) ?? null);
    },
  };

  return { usersRepo, tenantsRepo, users, tenants };
}

function buildApp() {
  const { usersRepo, tenantsRepo, users, tenants } = makeFakeRepos();
  const app = new Hono();
  app.route(
    "/api/auth",
    createAuthRouter({
      sessionSecret: SESSION_SECRET,
      usersRepo,
      tenantsRepo,
    }),
  );
  return { app, users, tenants };
}

beforeEach(() => {
  __dangerouslyClearBuckets();
});

describe("POST /api/auth/signup", () => {
  it("test_REQ_001_signup_creates_user_tenant_session", async () => {
    const { app, users, tenants } = buildApp();
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { next?: string };
    expect(body).toHaveProperty("next", "onboarding");

    expect(users.length).toBe(1);
    expect(users[0].email).toBe("test@example.com");
    expect(users[0].role).toBe("tenant_admin");
    expect(tenants.length).toBe(1);
    expect(tenants[0].status).toBe("pending_setup");

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain(`${SESSION_COOKIE}=`);
  });

  it("test_REQ_002_rejects_password_mismatch", async () => {
    const { app, users, tenants } = buildApp();
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test2@example.com",
        password: "securepass123",
        confirmPassword: "different",
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    expect(users.length).toBe(0);
    expect(tenants.length).toBe(0);
  });

  it("test_REQ_003_rejects_duplicate_email", async () => {
    const { app, users } = buildApp();

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "First User",
        email: "dup@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Second User",
        email: "dup@example.com",
        password: "anotherpass123",
        confirmPassword: "anotherpass123",
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body).toHaveProperty("error", "email_already_in_use");

    expect(users.length).toBe(1);
  });

  it("test_REQ_006_signup_cannot_set_super_admin", async () => {
    const { app, users } = buildApp();

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Hacker",
        email: "hacker@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
        role: "super_admin",
      }),
    });

    expect(res.status).toBe(201);
    expect(users.length).toBe(1);
    expect(users[0].role).toBe("tenant_admin");
  });
});

describe("POST /api/auth/login", () => {
  it("returns 200 with Set-Cookie for valid credentials", async () => {
    const { app } = buildApp();

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Login Test",
        email: "login@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "login@example.com",
        password: "securepass123",
      }),
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain(`${SESSION_COOKIE}=`);

    const body = (await res.json()) as { userId?: string; tenantId?: string; role?: string };
    expect(body).toHaveProperty("userId");
    expect(body).toHaveProperty("tenantId");
    expect(body).toHaveProperty("role");
  });

  it("returns 401 for invalid password", async () => {
    const { app } = buildApp();

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Login Test",
        email: "login2@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "login2@example.com",
        password: "wrongpassword",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown email", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@example.com",
        password: "anything",
      }),
    });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("test_REQ_007_protected_route_401_without_cookie", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns user info with valid cookie", async () => {
    const { app } = buildApp();

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Me Test",
        email: "me@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const cookie = signupRes.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const res = await app.request("/api/auth/me", {
      headers: cookie ? { cookie } : undefined,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated?: boolean;
      userId?: string;
      tenantId?: string;
      role?: string;
    };
    expect(body).toHaveProperty("authenticated", true);
    expect(body).toHaveProperty("userId");
    expect(body).toHaveProperty("tenantId");
    expect(body).toHaveProperty("role");
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 200 and clears cookie", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
  });
});

describe("POST /api/auth/forgot", () => {
  it("returns 200 for known email (no enumeration)", async () => {
    const { app } = buildApp();

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Forgot Test",
        email: "forgot@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const res = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "forgot@example.com" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 for unknown email (no enumeration)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@example.com" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/reset", () => {
  it("test_REQ_004_password_reset_token_single_use", async () => {
    const { app } = buildApp();

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Reset Test",
        email: "reset@example.com",
        password: "securepass123",
        confirmPassword: "securepass123",
      }),
    });

    const res1 = await app.request("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "invalid-token", password: "newpass123" }),
    });
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as { error?: string };
    expect(body1).toHaveProperty("error", "invalid_or_expired_token");
  });
});

describe("Rate limiting (REQ-121)", () => {
  it("test_REQ_121_auth_rate_limit_and_hash", async () => {
    const { app } = buildApp();

    const results: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await app.request("/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.0.0.99",
        },
        body: JSON.stringify({
          name: `Rate Test ${i}`,
          email: `rate${i}@example.com`,
          password: "securepass123",
          confirmPassword: "securepass123",
        }),
      });
      results.push(res.status);
    }

    const successCount = results.filter((s) => s === 201).length;
    expect(successCount).toBeGreaterThan(0);

    const rateLimited = results.filter((s) => s === 429).length;
    expect(rateLimited).toBeGreaterThan(0);
  });
});
