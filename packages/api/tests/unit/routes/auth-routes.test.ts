import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Hono } from "hono";
import type { TenantSelect, UserSelect } from "@newsletter/shared";
import { createAuthRouter, type AuthRouterDeps } from "@api/routes/auth.js";
import { hashPassword } from "@api/lib/password.js";
import { issueSession, verifySession, COOKIE_NAME } from "@api/auth/session.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { PasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";

const SECRET = "unit-test-session-secret-32-bytes!!";
const PASSWORD = "hunter2hunter2";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

const TENANT: TenantSelect = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "pending-abcd1234",
  previousSlug: null,
  name: "My Newsletter",
  status: "pending_setup",
  headline: null,
  topicStrip: null,
  subtagline: null,
  logo: null,
  logoContentType: null,
  logoVersion: 0,
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
  onboarding: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

function makeUser(overrides?: Partial<UserSelect>): UserSelect {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: TENANT.id,
    email: "ada@example.com",
    name: "Ada",
    passwordHash,
    role: "tenant_admin",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

function makeUsersRepo(overrides?: Partial<UsersRepo>): UsersRepo {
  return {
    findByEmail: vi.fn(() => Promise.resolve<UserSelect | null>(null)),
    findById: vi.fn(() => Promise.resolve<UserSelect | null>(makeUser())),
    findTenantById: vi.fn(() => Promise.resolve<TenantSelect | null>(TENANT)),
    createTenantAdminWithTenant: vi.fn(() =>
      Promise.resolve({ user: makeUser(), tenant: TENANT }),
    ),
    updatePassword: vi.fn(() => Promise.resolve()),
    createSuperAdmin: vi.fn(() => Promise.resolve(makeUser())),
    ...overrides,
  };
}

function makeResetRepo(
  overrides?: Partial<PasswordResetTokensRepo>,
): PasswordResetTokensRepo {
  return {
    create: vi.fn((userId: string, tokenHash: string, expiresAt: Date) =>
      Promise.resolve({
        id: "reset-1",
        userId,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      }),
    ),
    findValidByHash: vi.fn(() => Promise.resolve(null)),
    consume: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

interface TestDeps {
  usersRepo: UsersRepo;
  resetRepo: PasswordResetTokensRepo;
  send: ReturnType<typeof vi.fn>;
  flushBackground: () => Promise<void>;
}

function makeApp(partial?: Partial<TestDeps & AuthRouterDeps>): {
  app: Hono;
  deps: TestDeps;
} {
  const usersRepo = partial?.usersRepo ?? makeUsersRepo();
  const resetRepo = partial?.resetRepo ?? makeResetRepo();
  const send =
    partial?.send ?? vi.fn(() => Promise.resolve({ messageId: "msg-1" }));
  const backgroundTasks: Promise<void>[] = [];
  const app = new Hono();
  app.route(
    "/api/auth",
    createAuthRouter({
      sessionSecret: SECRET,
      getUsersRepo: () => usersRepo,
      getResetTokensRepo: () => resetRepo,
      emailProvider: { send },
      fromEmail: "platform@example.com",
      webBaseUrl: "https://app.example.com",
      limiters: partial?.limiters,
      runInBackground: (task) => {
        backgroundTasks.push(task);
      },
    }),
  );
  return {
    app,
    deps: {
      usersRepo,
      resetRepo,
      send,
      flushBackground: async () => {
        await Promise.all(backgroundTasks);
      },
    },
  };
}

function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookieOf(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("expected Set-Cookie");
  const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (!match) throw new Error(`no ${COOKIE_NAME} cookie in ${setCookie}`);
  return match[1];
}

const signupBody = {
  name: "Ada",
  email: "ada@example.com",
  password: PASSWORD,
  confirmPassword: PASSWORD,
};

describe("POST /api/auth/signup", () => {
  it("creates a tenant_admin + pending tenant and sets a session cookie", async () => {
    const { app, deps } = makeApp();
    const res = await postJson(app, "/api/auth/signup", signupBody);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      user: {
        id: makeUser().id,
        name: "Ada",
        email: "ada@example.com",
        role: "tenant_admin",
      },
      tenant: { id: TENANT.id, status: "pending_setup" },
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const claims = verifySession(sessionCookieOf(res), SECRET);
    expect(claims).toMatchObject({
      uid: makeUser().id,
      tid: TENANT.id,
      role: "tenant_admin",
    });
    expect(deps.usersRepo.createTenantAdminWithTenant).toHaveBeenCalledOnce();
  });

  it("test_REQ_002_rejects_password_mismatch before any DB write", async () => {
    const { app, deps } = makeApp();
    const res = await postJson(app, "/api/auth/signup", {
      ...signupBody,
      confirmPassword: "different-password",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields?: unknown };
    expect(body.error).toBe("invalid_body");
    expect(JSON.stringify(body)).toContain("confirmPassword");
    expect(deps.usersRepo.createTenantAdminWithTenant).not.toHaveBeenCalled();
    expect(deps.usersRepo.findByEmail).not.toHaveBeenCalled();
  });

  it("rejects duplicate email with 409 (pre-check)", async () => {
    const { app, deps } = makeApp({
      usersRepo: makeUsersRepo({
        findByEmail: vi.fn(() => Promise.resolve(makeUser())),
      }),
    });
    const res = await postJson(app, "/api/auth/signup", signupBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email already in use" });
    expect(deps.usersRepo.createTenantAdminWithTenant).not.toHaveBeenCalled();
  });

  it("test_REQ_006_signup_cannot_set_super_admin", async () => {
    const { app, deps } = makeApp();
    const res = await postJson(app, "/api/auth/signup", {
      ...signupBody,
      role: "super_admin",
    });
    expect(res.status).toBe(201);
    const call = vi.mocked(deps.usersRepo.createTenantAdminWithTenant).mock
      .calls[0][0];
    expect(JSON.stringify(call)).not.toContain("super_admin");
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe("tenant_admin");
  });

  it("applies the signup rate limiter when provided", async () => {
    const { app } = makeApp({
      limiters: {
        signup: (c) => Promise.resolve(c.json({ error: "rate_limited" }, 429)),
      },
    });
    const res = await postJson(app, "/api/auth/signup", signupBody);
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials and sets a session cookie", async () => {
    const { app } = makeApp({
      usersRepo: makeUsersRepo({
        findByEmail: vi.fn(() => Promise.resolve(makeUser())),
      }),
    });
    const res = await postJson(app, "/api/auth/login", {
      email: "Ada@Example.com",
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const claims = verifySession(sessionCookieOf(res), SECRET);
    expect(claims).toMatchObject({ uid: makeUser().id, tid: TENANT.id });
  });

  it("returns a uniform 401 for a wrong password", async () => {
    const { app } = makeApp({
      usersRepo: makeUsersRepo({
        findByEmail: vi.fn(() => Promise.resolve(makeUser())),
      }),
    });
    const res = await postJson(app, "/api/auth/login", {
      email: "ada@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("returns the same 401 for an unknown email (no enumeration)", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/auth/login", {
      email: "nobody@example.com",
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("pays the bcrypt cost for unknown emails (timing-uniform 401)", async () => {
    const { verifyPassword } = await import("@api/lib/password.js");
    // Self-calibrating: one real bcrypt verify is the timing floor.
    const t0 = performance.now();
    await verifyPassword("calibration", passwordHash);
    const bcryptMs = performance.now() - t0;

    const { app } = makeApp();
    const t1 = performance.now();
    const res = await postJson(app, "/api/auth/login", {
      email: "nobody@example.com",
      password: PASSWORD,
    });
    const loginMs = performance.now() - t1;
    expect(res.status).toBe(401);
    expect(loginMs).toBeGreaterThan(bcryptMs * 0.5);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a cookie", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the auth context, user, and tenant", async () => {
    const { app } = makeApp();
    const token = issueSession(
      { uid: makeUser().id, tid: TENANT.id, role: "tenant_admin" },
      SECRET,
    );
    const res = await app.request("/api/auth/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        id: makeUser().id,
        name: "Ada",
        email: "ada@example.com",
        role: "tenant_admin",
      },
      tenant: {
        id: TENANT.id,
        name: "My Newsletter",
        slug: "pending-abcd1234",
        status: "pending_setup",
      },
      impersonating: false,
    });
  });

  it("returns 401 when the session user no longer exists", async () => {
    const { app } = makeApp({
      usersRepo: makeUsersRepo({
        findById: vi.fn(() => Promise.resolve(null)),
      }),
    });
    const token = issueSession(
      { uid: "gone", tid: TENANT.id, role: "tenant_admin" },
      SECRET,
    );
    const res = await app.request("/api/auth/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/forgot-password (REQ-004)", () => {
  it("stores a hashed token and emails a reset link for a known email", async () => {
    const { app, deps } = makeApp({
      usersRepo: makeUsersRepo({
        findByEmail: vi.fn(() => Promise.resolve(makeUser())),
      }),
    });
    const res = await postJson(app, "/api/auth/forgot-password", {
      email: "ada@example.com",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await deps.flushBackground();

    expect(deps.resetRepo.create).toHaveBeenCalledOnce();
    const [userId, storedHash] = vi.mocked(deps.resetRepo.create).mock
      .calls[0];
    expect(userId).toBe(makeUser().id);

    expect(deps.send).toHaveBeenCalledOnce();
    const sendArgs = deps.send.mock.calls[0][0] as {
      to: string[];
      from: string;
      text: string;
    };
    expect(sendArgs.to).toEqual(["ada@example.com"]);
    expect(sendArgs.from).toBe("platform@example.com");
    const url = /https:\/\/app\.example\.com\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(
      sendArgs.text,
    );
    if (!url) throw new Error(`no reset link in: ${sendArgs.text}`);
    const rawToken = url[1];
    expect(createHash("sha256").update(rawToken).digest("hex")).toBe(
      storedHash,
    );
  });

  it("returns the identical 200 for an unknown email and sends nothing", async () => {
    const { app, deps } = makeApp();
    const res = await postJson(app, "/api/auth/forgot-password", {
      email: "nobody@example.com",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await deps.flushBackground();
    expect(deps.resetRepo.create).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("responds before the reset email send resolves (timing-uniform, REQ-004)", async () => {
    let resolveSend: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<{ messageId: string }>((resolve) => {
          resolveSend = () => {
            resolve({ messageId: "msg-slow" });
          };
        }),
    );
    const { app, deps } = makeApp({
      send,
      usersRepo: makeUsersRepo({
        findByEmail: vi.fn(() => Promise.resolve(makeUser())),
      }),
    });
    // The send promise never resolves until we release it — if the handler
    // awaited it on the response path, this would hang past the test timeout.
    const res = await postJson(app, "/api/auth/forgot-password", {
      email: "ada@example.com",
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
    resolveSend?.();
    await deps.flushBackground();
  });

  it("applies the forgot-password rate limiter when provided", async () => {
    const { app } = makeApp({
      limiters: {
        forgotPassword: (c) =>
          Promise.resolve(c.json({ error: "rate_limited" }, 429)),
      },
    });
    const res = await postJson(app, "/api/auth/forgot-password", {
      email: "ada@example.com",
    });
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/reset-password", () => {
  const rawToken = "a".repeat(64);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  it("resets the password for a valid token and marks it used", async () => {
    const resetRepo = makeResetRepo({
      findValidByHash: vi.fn(() =>
        Promise.resolve({
          id: "reset-1",
          userId: makeUser().id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
          createdAt: new Date(),
        }),
      ),
    });
    const { app, deps } = makeApp({ resetRepo });
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "new-password-123",
      confirmPassword: "new-password-123",
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(resetRepo.findValidByHash).mock.calls[0][0]).toBe(
      tokenHash,
    );
    expect(resetRepo.consume).toHaveBeenCalledWith("reset-1");
    expect(deps.usersRepo.updatePassword).toHaveBeenCalledOnce();
    const [userId, newHash] = vi.mocked(deps.usersRepo.updatePassword).mock
      .calls[0];
    expect(userId).toBe(makeUser().id);
    expect(newHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("returns 400 invalid_or_expired for an unknown token", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "new-password-123",
      confirmPassword: "new-password-123",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("rejects mismatched passwords without touching the token", async () => {
    const { app, deps } = makeApp();
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "new-password-123",
      confirmPassword: "other-password",
    });
    expect(res.status).toBe(400);
    expect(deps.resetRepo.findValidByHash).not.toHaveBeenCalled();
  });

  it("returns 400 and leaves the password unchanged when the token was concurrently consumed", async () => {
    const resetRepo = makeResetRepo({
      findValidByHash: vi.fn(() =>
        Promise.resolve({
          id: "reset-1",
          userId: makeUser().id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
          createdAt: new Date(),
        }),
      ),
      consume: vi.fn(() => Promise.resolve(false)),
    });
    const { app, deps } = makeApp({ resetRepo });
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "new-password-123",
      confirmPassword: "new-password-123",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_or_expired" });
    expect(deps.usersRepo.updatePassword).not.toHaveBeenCalled();
  });

  it("applies the reset-password rate limiter when provided (REQ-121)", async () => {
    const { app } = makeApp({
      limiters: {
        resetPassword: (c) =>
          Promise.resolve(c.json({ error: "rate_limited" }, 429)),
      },
    });
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "new-password-123",
      confirmPassword: "new-password-123",
    });
    expect(res.status).toBe(429);
  });
});
