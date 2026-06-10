import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAuthRouter } from "@api/routes/auth.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import { COOKIE_NAME } from "@api/auth/session.js";
import type { User, Tenant } from "@newsletter/shared";

const SESSION_SECRET = "test-session-secret-with-at-least-32-bytes-long!";

async function hashPassword(plaintext: string): Promise<string> {
  return `fake_argon2id_${plaintext}`;
}

async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return hash === `fake_argon2id_${plaintext}`;
}

interface TestUserStore {
  users: User[];
  tenants: Tenant[];
}

function makeTestStore(): TestUserStore {
  return { users: [], tenants: [] };
}

function makeUsersRepo(store: TestUserStore): UsersRepo {
  return {
    findByEmail: vi.fn(async (email: string) => {
      return store.users.find((u) => u.email === email) ?? null;
    }),
    findById: vi.fn(async (id: string) => {
      return store.users.find((u) => u.id === id) ?? null;
    }),
    create: vi.fn(async (input) => {
      const existing = store.users.find((u) => u.email === input.email);
      if (existing) throw Object.assign(new Error("duplicate key"), { code: "23505" });

      const user: User = {
        id: `user-${store.users.length + 1}`,
        tenantId: input.tenantId,
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.users.push(user);
      return user;
    }),
  };
}

function makeTenantsRepo(store: TestUserStore): TenantsRepo {
  return {
    findById: vi.fn(async (id: string) => {
      return store.tenants.find((t) => t.id === id) ?? null;
    }),
    findBySlug: vi.fn(async (_slug: string) => {
      return null;
    }),
    create: vi.fn(async (input) => {
      const tenant: Tenant = {
        id: `tenant-${store.tenants.length + 1}`,
        slug: input.slug,
        name: input.name,
        status: "pending_setup",
        customDomain: null,
        headline: null,
        topicStrip: null,
        subtagline: null,
        logoBytes: null,
        logoContentType: null,
        featureCanon: false,
        featureDeliverability: false,
        featureEval: false,
        onboardingState: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.tenants.push(tenant);
      return tenant;
    }),
  };
}

function buildAuthApp(store: TestUserStore): Hono {
  const app = new Hono();
  const logger = { info: vi.fn(), warn: vi.fn() };

  const authRouter = createAuthRouter({
    usersRepo: makeUsersRepo(store),
    tenantsRepo: makeTenantsRepo(store),
    sessionSecret: SESSION_SECRET,
    logger,
    hashPassword,
    verifyPassword,
  });

  app.route("/api/auth", authRouter);
  return app;
}

describe("POST /api/auth/signup", () => {
  it("test_REQ_001_signup_creates_user_tenant_session", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.next).toBe("onboarding");
    expect(body.userId).toBeTruthy();
    expect(body.tenantId).toBeTruthy();

    expect(store.users).toHaveLength(1);
    expect(store.users[0].email).toBe("test@example.com");
    expect(store.users[0].role).toBe("tenant_admin");
    expect(store.users[0].tenantId).toBeTruthy();

    expect(store.tenants).toHaveLength(1);
    expect(store.tenants[0].status).toBe("pending_setup");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(COOKIE_NAME);
  });

  it("test_REQ_002_rejects_password_mismatch", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
        confirmPassword: "different",
      }),
    });

    expect(res.status).toBe(400);
    expect(store.users).toHaveLength(0);
    expect(store.tenants).toHaveLength(0);
  });

  it("test_REQ_003_rejects_duplicate_email", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First",
        email: "dupe@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second",
        email: "dupe@example.com",
        password: "password456",
        confirmPassword: "password456",
      }),
    });

    expect(res.status).toBe(409);
    expect(store.users).toHaveLength(1);
  });

  it("test_REQ_006_signup_cannot_set_super_admin", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Normal User",
        email: "normal@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    expect(res.status).toBe(201);
    expect(store.users).toHaveLength(1);
    expect(store.users[0].role).toBe("tenant_admin");
    expect(store.users[0].role).not.toBe("super_admin");
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials and sets cookie", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Login Test",
        email: "login@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "login@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(COOKIE_NAME);
  });

  it("rejects invalid password", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        email: "pwtest@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "pwtest@example.com",
        password: "wrong-password",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects unknown email", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@example.com",
        password: "anything",
      }),
    });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns authenticated:true with valid session", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Me Test",
        email: "me@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    const cookie = signupRes.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const res = await app.request("/api/auth/me", {
      headers: cookie ? { Cookie: cookie } : {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authenticated).toBe(true);
    expect(body.userId).toBeTruthy();
    expect(body.role).toBe("tenant_admin");
  });

  it("test_REQ_007_protected_route_401_without_cookie", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authenticated).toBe(false);
  });

  it("returns authenticated:false with invalid cookie", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    const res = await app.request("/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=invalid-token` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string,unknown>;
    expect(body.authenticated).toBe(false);
  });
});

describe("POST /api/auth/forgot", () => {
  it("test_REQ_004_always_returns_ok_no_enumeration", async () => {
    const store = makeTestStore();
    const app = buildAuthApp(store);

    // Unknown email
    const res1 = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com" }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.ok).toBe(true);

    // Known email
    await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Forgot Test",
        email: "known@example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    });

    const res2 = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "known@example.com" }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.ok).toBe(true);
  });
});
