import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { createAuthRouter } from "../auth.js";
import type { AuthRouterDeps } from "../auth.js";
import { COOKIE_NAME, verifySession } from "../../auth/session.js";
import { hashPassword } from "@api/services/password.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { PasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";
import type { UserRow, PasswordResetTokenSelect, TenantRow } from "@newsletter/shared";

const SESSION_SECRET = "test-session-secret-at-least-32-bytes!!";
const WEB_BASE_URL = "https://app.lvh.me";

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    email: "user@example.com",
    name: "User",
    passwordHash: "hash",
    role: "tenant_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTenantRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return { id: "tenant-1", status: "pending_setup", ...overrides } as TenantRow;
}

function makeResetRecord(
  overrides: Partial<PasswordResetTokenSelect> = {},
): PasswordResetTokenSelect {
  return {
    id: "tok-1",
    userId: "u-1",
    tokenHash: "hash",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMocks() {
  const usersGetByEmail = vi.fn<UsersRepo["getByEmail"]>().mockResolvedValue(null);
  const usersCreate = vi.fn<UsersRepo["create"]>().mockResolvedValue(makeUserRow());
  const usersUpdatePassword = vi
    .fn<UsersRepo["updatePassword"]>()
    .mockResolvedValue(undefined);
  const tenantsCreate = vi
    .fn<TenantsRepo["create"]>()
    .mockResolvedValue(makeTenantRow());
  const tokensCreate = vi
    .fn<PasswordResetTokensRepo["create"]>()
    .mockResolvedValue(makeResetRecord());
  const tokensFindByHash = vi
    .fn<PasswordResetTokensRepo["findByHash"]>()
    .mockResolvedValue(null);
  const tokensMarkUsed = vi
    .fn<PasswordResetTokensRepo["markUsed"]>()
    .mockResolvedValue(undefined);
  const sendPasswordResetEmail = vi
    .fn<AuthRouterDeps["sendPasswordResetEmail"]>()
    .mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const usersRepo: UsersRepo = {
    getByEmail: usersGetByEmail,
    create: usersCreate,
    getById: vi.fn<UsersRepo["getById"]>().mockResolvedValue(null),
    updatePassword: usersUpdatePassword,
  };
  const tenantsRepo = { create: tenantsCreate } as unknown as TenantsRepo;
  const passwordResetTokensRepo: PasswordResetTokensRepo = {
    create: tokensCreate,
    findByHash: tokensFindByHash,
    markUsed: tokensMarkUsed,
  };

  const deps: AuthRouterDeps = {
    usersRepo,
    tenantsRepo,
    passwordResetTokensRepo,
    sessionSecret: SESSION_SECRET,
    webBaseUrl: WEB_BASE_URL,
    sendPasswordResetEmail,
    logger: logger as unknown as AuthRouterDeps["logger"],
  };

  return {
    deps,
    usersGetByEmail,
    usersCreate,
    usersUpdatePassword,
    tenantsCreate,
    tokensCreate,
    tokensFindByHash,
    tokensMarkUsed,
    sendPasswordResetEmail,
  };
}

function makeApp(deps: AuthRouterDeps): Hono {
  const app = new Hono();
  app.route("/api/auth", createAuthRouter(deps));
  return app;
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readSession(res: Response): ReturnType<typeof verifySession> {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const token = setCookie.split(`${COOKIE_NAME}=`)[1].split(";")[0];
  return verifySession(decodeURIComponent(token), SESSION_SECRET);
}

describe("POST /api/auth/signup", () => {
  it("creates tenant_admin + pending tenant, sets session cookie (REQ-001)", async () => {
    const m = makeMocks();
    m.usersCreate.mockResolvedValue(makeUserRow({ id: "u-new", tenantId: "tenant-1" }));
    const res = await post(makeApp(m.deps), "/api/auth/signup", {
      name: "Ada",
      email: "Ada@Example.com",
      password: "supersecret",
      confirmPassword: "supersecret",
    });

    expect(res.status).toBe(201);
    expect(m.tenantsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending_setup" }),
    );
    const createArg = m.usersCreate.mock.calls[0][0];
    expect(createArg.role).toBe("tenant_admin");
    expect(createArg.email).toBe("ada@example.com");
    expect(readSession(res)).toMatchObject({
      userId: "u-new",
      tenantId: "tenant-1",
      role: "tenant_admin",
    });
  });

  it("rejects mismatched confirmPassword, creates no rows (REQ-002)", async () => {
    const m = makeMocks();
    const res = await post(makeApp(m.deps), "/api/auth/signup", {
      name: "Ada",
      email: "ada@example.com",
      password: "supersecret",
      confirmPassword: "different!",
    });
    expect(res.status).toBe(400);
    expect(m.tenantsCreate).not.toHaveBeenCalled();
    expect(m.usersCreate).not.toHaveBeenCalled();
  });

  it("rejects duplicate email, creates no second account (REQ-003)", async () => {
    const m = makeMocks();
    m.usersGetByEmail.mockResolvedValue(makeUserRow());
    const res = await post(makeApp(m.deps), "/api/auth/signup", {
      name: "Ada",
      email: "user@example.com",
      password: "supersecret",
      confirmPassword: "supersecret",
    });
    expect(res.status).toBe(409);
    expect(m.tenantsCreate).not.toHaveBeenCalled();
    expect(m.usersCreate).not.toHaveBeenCalled();
  });

  it("never assigns super_admin via signup (REQ-006)", async () => {
    const m = makeMocks();
    m.usersCreate.mockResolvedValue(makeUserRow());
    await post(makeApp(m.deps), "/api/auth/signup", {
      name: "Sneaky",
      email: "sneaky@example.com",
      password: "supersecret",
      confirmPassword: "supersecret",
      role: "super_admin",
    });
    expect(m.usersCreate.mock.calls[0][0].role).toBe("tenant_admin");
  });
});

describe("POST /api/auth/login", () => {
  it("verifies hash and sets session cookie", async () => {
    const passwordHash = await hashPassword("supersecret");
    const m = makeMocks();
    m.usersGetByEmail.mockResolvedValue(
      makeUserRow({ id: "u-1", tenantId: "t-1", passwordHash, role: "tenant_admin" }),
    );
    const res = await post(makeApp(m.deps), "/api/auth/login", {
      email: "user@example.com",
      password: "supersecret",
    });
    expect(res.status).toBe(200);
    expect(readSession(res)).toMatchObject({ userId: "u-1", tenantId: "t-1" });
  });

  it("returns 401 on wrong password, no cookie", async () => {
    const passwordHash = await hashPassword("supersecret");
    const m = makeMocks();
    m.usersGetByEmail.mockResolvedValue(makeUserRow({ passwordHash }));
    const res = await post(makeApp(m.deps), "/api/auth/login", {
      email: "user@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 for unknown email", async () => {
    const m = makeMocks();
    const res = await post(makeApp(m.deps), "/api/auth/login", {
      email: "nobody@example.com",
      password: "whatever1",
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const m = makeMocks();
    const res = await post(makeApp(m.deps), "/api/auth/logout", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});

describe("POST /api/auth/forgot (REQ-004)", () => {
  it("sends a reset email for a known address", async () => {
    const m = makeMocks();
    m.usersGetByEmail.mockResolvedValue(
      makeUserRow({ id: "u-1", email: "user@example.com" }),
    );
    const res = await post(makeApp(m.deps), "/api/auth/forgot", {
      email: "user@example.com",
    });
    expect(res.status).toBe(200);
    expect(m.tokensCreate).toHaveBeenCalledTimes(1);
    expect(m.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const resetUrl = m.sendPasswordResetEmail.mock.calls[0][1];
    expect(resetUrl).toContain(`${WEB_BASE_URL}/reset?token=`);
  });

  it("produces no enumeration difference for unknown email", async () => {
    const m = makeMocks();
    const res = await post(makeApp(m.deps), "/api/auth/forgot", {
      email: "nobody@example.com",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.tokensCreate).not.toHaveBeenCalled();
    expect(m.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset", () => {
  function tokenAndHash(): { token: string; tokenHash: string } {
    const token = "raw-reset-token-abc123";
    return {
      token,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    };
  }

  it("consumes a valid token and sets a new password hash", async () => {
    const { token, tokenHash } = tokenAndHash();
    const m = makeMocks();
    m.tokensFindByHash.mockResolvedValue(
      makeResetRecord({ id: "tok-1", userId: "u-1", tokenHash }),
    );
    const res = await post(makeApp(m.deps), "/api/auth/reset", {
      token,
      password: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(res.status).toBe(200);
    expect(m.usersUpdatePassword).toHaveBeenCalledTimes(1);
    expect(m.usersUpdatePassword.mock.calls[0][0]).toBe("u-1");
    expect(m.tokensMarkUsed).toHaveBeenCalledWith("tok-1");
  });

  it("rejects an already-used token", async () => {
    const { token, tokenHash } = tokenAndHash();
    const m = makeMocks();
    m.tokensFindByHash.mockResolvedValue(
      makeResetRecord({ tokenHash, usedAt: new Date() }),
    );
    const res = await post(makeApp(m.deps), "/api/auth/reset", {
      token,
      password: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(res.status).toBe(400);
    expect(m.usersUpdatePassword).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    const { token, tokenHash } = tokenAndHash();
    const m = makeMocks();
    m.tokensFindByHash.mockResolvedValue(
      makeResetRecord({ tokenHash, expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await post(makeApp(m.deps), "/api/auth/reset", {
      token,
      password: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(res.status).toBe(400);
    expect(m.usersUpdatePassword).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    const m = makeMocks();
    const res = await post(makeApp(m.deps), "/api/auth/reset", {
      token: "nope",
      password: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(res.status).toBe(400);
  });
});
