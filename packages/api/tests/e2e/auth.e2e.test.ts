/**
 * Phase 3 integration: real DB (users + tenants) through the auth router.
 * Covers REQ-001 (signup creates rows + session), REQ-003 (duplicate email),
 * REQ-004 (reset token single-use, no enumeration), REQ-007 (401 without
 * cookie) and the REQ-121 rate limit on auth routes.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { describe, it, expect, vi, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, like, inArray } from "drizzle-orm";
import { getDb, users, tenants } from "@newsletter/shared/db";
import { createAuthRouter } from "@api/routes/auth.js";
import { createUsersRepo } from "@api/repositories/users.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { requireAuth, requireSuperAdmin } from "@api/auth/middleware.js";
import { createRateLimiter } from "@api/auth/rate-limit.js";
import { verifyToken, COOKIE_NAME } from "@api/auth/session.js";
import type { ResetTokenStore } from "@api/services/auth.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-xx";
const EMAIL_PREFIX = `p3auth-${Date.now()}`;

const db = getDb();

function makeTokenStore(): ResetTokenStore {
  const store = new Map<string, string>();
  return {
    save: (hash, userId) => {
      store.set(hash, userId);
      return Promise.resolve();
    },
    consume: (hash) => {
      const v = store.get(hash) ?? null;
      store.delete(hash);
      return Promise.resolve(v);
    },
  };
}

interface TestApp {
  app: Hono;
  sentResetUrls: string[];
}

function buildApp(opts?: { rateLimitCapacity?: number }): TestApp {
  const sentResetUrls: string[] = [];
  const app = new Hono();
  app.route(
    "/api/auth",
    createAuthRouter({
      sessionSecret: SESSION_SECRET,
      getUsersRepo: () => createUsersRepo(db),
      getTenantsRepo: () => createTenantsRepo(db),
      resetTokenStore: makeTokenStore(),
      sendResetEmail: (_email, url) => {
        sentResetUrls.push(url);
        return Promise.resolve();
      },
      webBaseUrl: "http://web.test",
      logger: { info: vi.fn(), warn: vi.fn() },
      rateLimiter: createRateLimiter({
        capacity: opts?.rateLimitCapacity ?? 1000,
        // No refill when testing the cap so the 4th call cannot sneak a token.
        refillPerSecond: opts?.rateLimitCapacity !== undefined ? 0 : 1000,
      }),
    }),
  );
  // Probe routes for middleware checks (REQ-007).
  app.get("/api/admin/probe", requireAuth(SESSION_SECRET), (c) =>
    c.json({ ctx: c.get("tenantCtx") }),
  );
  app.get("/api/super/probe", requireSuperAdmin(SESSION_SECRET), (c) =>
    c.json({ ok: true }),
  );
  return { app, sentResetUrls };
}

function signupBody(email: string, password = "p3-test-password-1"): string {
  return JSON.stringify({
    name: "P3 Test User",
    email,
    password,
    confirmPassword: password,
  });
}

function postJson(app: Hono, path: string, body: string, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("missing Set-Cookie");
  const m = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (!m) throw new Error(`no ${COOKIE_NAME} in ${setCookie}`);
  return `${COOKIE_NAME}=${m[1]}`;
}

afterAll(async () => {
  const testUsers = await db
    .select({ id: users.id, tenantId: users.tenantId })
    .from(users)
    .where(like(users.email, `${EMAIL_PREFIX}%`));
  const tenantIds = testUsers
    .map((u) => u.tenantId)
    .filter((t): t is string => t !== null);
  await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`));
  if (tenantIds.length > 0) {
    await db.delete(tenants).where(inArray(tenants.id, tenantIds));
  }
});

describe("POST /api/auth/signup", () => {
  it("test_REQ_001_signup_creates_user_tenant_session", async () => {
    const { app } = buildApp();
    const email = `${EMAIL_PREFIX}-req001@example.com`;
    const res = await postJson(app, "/api/auth/signup", signupBody(email));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { next: string };
    expect(body.next).toBe("onboarding");

    // DB rows: user (tenant_admin) + tenant (pending_setup).
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user).toBeDefined();
    expect(user.role).toBe("tenant_admin");
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.tenantId).not.toBeNull();
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, user.tenantId ?? ""));
    expect(tenant.status).toBe("pending_setup");

    // Session cookie encodes {userId, tenantId, role} (REQ-005 wire check).
    const cookie = sessionCookie(res);
    const token = cookie.split("=")[1];
    expect(verifyToken(token, SESSION_SECRET)).toEqual({
      userId: user.id,
      tenantId: user.tenantId,
      role: "tenant_admin",
    });
  });

  it("test_REQ_003_rejects_duplicate_email", async () => {
    const { app } = buildApp();
    const email = `${EMAIL_PREFIX}-req003@example.com`;
    const first = await postJson(app, "/api/auth/signup", signupBody(email));
    expect(first.status).toBe(201);
    const dup = await postJson(app, "/api/auth/signup", signupBody(email));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "email_in_use" });
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
  });

  it("rejects mismatched passwords with a field error and creates no rows (REQ-002 wire)", async () => {
    const { app } = buildApp();
    const email = `${EMAIL_PREFIX}-req002@example.com`;
    const res = await postJson(
      app,
      "/api/auth/signup",
      JSON.stringify({
        name: "X",
        email,
        password: "p3-test-password-1",
        confirmPassword: "p3-test-password-2",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      fieldErrors?: Record<string, string[]>;
    };
    expect(body.error).toBe("invalid_body");
    expect(body.fieldErrors?.confirmPassword?.length).toBeGreaterThan(0);
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });
});

describe("password reset flow", () => {
  it("test_REQ_004_password_reset_token_single_use", async () => {
    const { app, sentResetUrls } = buildApp();
    const email = `${EMAIL_PREFIX}-req004@example.com`;
    await postJson(app, "/api/auth/signup", signupBody(email));

    // Known email → 200 {ok:true} and a reset URL captured.
    const known = await postJson(app, "/api/auth/forgot", JSON.stringify({ email }));
    expect(known.status).toBe(200);
    const knownBody = await known.json();
    expect(sentResetUrls).toHaveLength(1);

    // Unknown email → identical response, no email sent (no enumeration).
    const unknown = await postJson(
      app,
      "/api/auth/forgot",
      JSON.stringify({ email: `${EMAIL_PREFIX}-nobody@example.com` }),
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(knownBody);
    expect(sentResetUrls).toHaveLength(1);

    const token = new URL(sentResetUrls[0]).searchParams.get("token");
    if (token === null) throw new Error("no token in reset url");

    // Reset with the token once → password actually changes.
    const reset = await postJson(
      app,
      "/api/auth/reset",
      JSON.stringify({
        token,
        password: "new-password-456",
        confirmPassword: "new-password-456",
      }),
    );
    expect(reset.status).toBe(200);

    const loginNew = await postJson(
      app,
      "/api/auth/login",
      JSON.stringify({ email, password: "new-password-456" }),
    );
    expect(loginNew.status).toBe(200);
    const loginOld = await postJson(
      app,
      "/api/auth/login",
      JSON.stringify({ email, password: "p3-test-password-1" }),
    );
    expect(loginOld.status).toBe(401);

    // Token is single-use: replay → 400.
    const replay = await postJson(
      app,
      "/api/auth/reset",
      JSON.stringify({
        token,
        password: "another-pass-789",
        confirmPassword: "another-pass-789",
      }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_token" });
  });
});

describe("auth middleware (REQ-007)", () => {
  it("test_REQ_007_protected_route_401_without_cookie", async () => {
    const { app } = buildApp();
    const noCookie = await app.request("/api/admin/probe");
    expect(noCookie.status).toBe(401);
    expect(await noCookie.json()).toEqual({ error: "unauthorized" });

    const garbage = await app.request("/api/admin/probe", {
      headers: { cookie: `${COOKIE_NAME}=garbage.token` },
    });
    expect(garbage.status).toBe(401);

    // With a valid session the route resolves and exposes tenantCtx.
    const email = `${EMAIL_PREFIX}-req007@example.com`;
    const signupRes = await postJson(app, "/api/auth/signup", signupBody(email));
    const cookie = sessionCookie(signupRes);
    const ok = await app.request("/api/admin/probe", { headers: { cookie } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      ctx: { userId: string; tenantId: string; role: string };
    };
    expect(body.ctx.role).toBe("tenant_admin");
    expect(body.ctx.tenantId).toBeTruthy();

    // tenant_admin is refused by the super-admin gate (403, not 401).
    const superRes = await app.request("/api/super/probe", { headers: { cookie } });
    expect(superRes.status).toBe(403);
  });

  it("GET /api/auth/me returns the session user + tenant", async () => {
    const { app } = buildApp();
    const email = `${EMAIL_PREFIX}-me@example.com`;
    const signupRes = await postJson(app, "/api/auth/signup", signupBody(email));
    const cookie = sessionCookie(signupRes);

    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      user: { email: string; role: string; tenantId: string | null };
      tenant: { status: string } | null;
    };
    expect(body.user.email.toLowerCase()).toBe(email.toLowerCase());
    expect(body.user.role).toBe("tenant_admin");
    expect(body.tenant?.status).toBe("pending_setup");

    const anon = await app.request("/api/auth/me");
    expect(anon.status).toBe(401);
  });
});

describe("rate limiting on auth routes (REQ-121)", () => {
  it("returns 429 after the burst capacity is exhausted", async () => {
    const { app } = buildApp({ rateLimitCapacity: 3 });
    const body = JSON.stringify({
      email: `${EMAIL_PREFIX}-rl@example.com`,
      password: "wrong-password-1",
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7",
        },
        body,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses[3]).toBe(429);
  });
});
