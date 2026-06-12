/**
 * E2E for the multi-tenant auth stack against the real DB.
 * Covers REQ-001, REQ-003, REQ-004, REQ-007, REQ-121 (+ NF-006 SameSite,
 * relocated from admin-must-read.e2e.test.ts).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
} from "vitest";
import { Hono } from "hono";
import { setTestTenant } from "../helpers/tenant.js";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import type { SendEmailParams } from "@newsletter/shared";
import { createAuthRouter } from "@api/routes/auth.js";
import { requireUser } from "@api/auth/middleware.js";
import { COOKIE_NAME } from "@api/auth/session.js";
import { createRateLimiter, type RateLimitRedis } from "@api/lib/rate-limit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createUsersRepo, EmailInUseError } = await import(
  "@api/repositories/users.js"
);
const { createPasswordResetTokensRepo } = await import(
  "@api/repositories/password-reset-tokens.js"
);

const db = getDb();
const usersRepo = createUsersRepo(db);
const resetRepo = createPasswordResetTokensRepo(db);

const SESSION_SECRET = "auth-e2e-session-secret-32-bytes!";
const EMAIL_DOMAIN = "auth-e2e.example.com";
const PASSWORD = "swordfish-pass-1";

async function wipe(): Promise<void> {
  await db.execute(sql`
    DELETE FROM password_reset_tokens
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${"%@" + EMAIL_DOMAIN})
  `);
  const tenantIds = await db.execute(sql`
    SELECT tenant_id FROM users WHERE email LIKE ${"%@" + EMAIL_DOMAIN}
  `);
  await db.execute(
    sql`DELETE FROM users WHERE email LIKE ${"%@" + EMAIL_DOMAIN}`,
  );
  for (const row of tenantIds as Iterable<{ tenant_id: string | null }>) {
    if (row.tenant_id) {
      await db.execute(sql`DELETE FROM tenants WHERE id = ${row.tenant_id}`);
    }
  }
}

beforeAll(wipe);
afterAll(wipe);

interface TestApp {
  app: Hono;
  sends: SendEmailParams[];
  flushBackground: () => Promise<void>;
}

function buildAuthApp(opts?: { signupLimiterMax?: number }): TestApp {
  const sends: SendEmailParams[] = [];
  const backgroundTasks: Promise<void>[] = [];
  const app = new Hono();
  app.use("*", setTestTenant());
  const limiters =
    opts?.signupLimiterMax !== undefined
      ? {
          signup: createRateLimiter({
            redis: makeFakeRedis(),
            windowSeconds: 900,
            max: opts.signupLimiterMax,
            prefix: "rl-e2e",
            // app.request() has no conninfo; trust the single XFF hop the
            // test sets so the limiter keys per IP.
            trustProxyHops: 1,
          }),
        }
      : undefined;
  app.route(
    "/api/auth",
    createAuthRouter({
      sessionSecret: SESSION_SECRET,
      getUsersRepo: () => usersRepo,
      getResetTokensRepo: () => resetRepo,
      emailProvider: {
        send: (params) => {
          sends.push(params);
          return Promise.resolve({ messageId: `msg-${sends.length}` });
        },
      },
      fromEmail: "platform@example.com",
      webBaseUrl: "https://app.example.com",
      limiters,
      runInBackground: (task) => {
        backgroundTasks.push(task);
      },
    }),
  );
  // A representative protected admin route for REQ-007.
  const adminApp = new Hono();
  adminApp.use("*", requireUser(SESSION_SECRET));
  adminApp.get("/probe", (c) => c.json({ ok: true }));
  app.route("/api/admin", adminApp);
  return {
    app,
    sends,
    flushBackground: async () => {
      await Promise.all(backgroundTasks);
    },
  };
}

function makeFakeRedis(): RateLimitRedis {
  const counts = new Map<string, number>();
  return {
    incr: (key) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    expire: () => Promise.resolve(1),
  };
}

let emailSeq = 0;
function uniqueEmail(label: string): string {
  emailSeq += 1;
  return `${label}-${Date.now()}-${emailSeq}@${EMAIL_DOMAIN}`;
}

function postJson(app: Hono, path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieOf(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("expected Set-Cookie");
  const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (!match) throw new Error(`no ${COOKIE_NAME} cookie in ${setCookie}`);
  return `${COOKIE_NAME}=${match[1]}`;
}

function signup(app: Hono, email: string): Promise<Response> {
  return postJson(app, "/api/auth/signup", {
    name: "E2E User",
    email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
}

describe("test_REQ_001_signup_creates_user_tenant_session", () => {
  it("creates a tenant_admin user + pending_setup tenant and sets a session cookie", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("signup");
    const res = await signup(app, email);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      user: { id: string; role: string; email: string };
      tenant: { id: string; status: string };
    };
    expect(body.user.role).toBe("tenant_admin");
    expect(body.tenant.status).toBe("pending_setup");

    const user = await usersRepo.findByEmail(email);
    if (!user) throw new Error("user row not created");
    expect(user.role).toBe("tenant_admin");
    expect(user.tenantId).toBe(body.tenant.id);

    const tenant = await usersRepo.findTenantById(body.tenant.id);
    if (!tenant) throw new Error("tenant row not created");
    expect(tenant.status).toBe("pending_setup");
    expect(tenant.slug).toMatch(/^pending-[0-9a-f]{8}$/);

    // NF-006: session cookie attributes.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/SameSite=(Lax|Strict)/i);
    expect(setCookie).toMatch(/HttpOnly/i);

    // Session works against /me.
    const me = await app.request("/api/auth/me", {
      headers: { cookie: cookieOf(res) },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      user: { email: string };
      tenant: { id: string };
      impersonating: boolean;
    };
    expect(meBody.user.email).toBe(email);
    expect(meBody.tenant.id).toBe(body.tenant.id);
    expect(meBody.impersonating).toBe(false);
  });

  it("REQ-121: stores the password as bcrypt cost >= 12", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("hash");
    await signup(app, email);
    const user = await usersRepo.findByEmail(email);
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("lowercases the stored email", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("case");
    const res = await signup(app, email.toUpperCase());
    expect(res.status).toBe(201);
    expect(await usersRepo.findByEmail(email)).not.toBeNull();
  });
});

describe("test_REQ_003_rejects_duplicate_email", () => {
  it("returns 409 and creates no second account", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("dup");
    expect((await signup(app, email)).status).toBe(201);

    const res = await signup(app, email);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email already in use" });

    const count = await db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE email = ${email}`,
    );
    expect((count as unknown as { n: number }[])[0].n).toBe(1);
  });

  it("maps the real users_email_unique 23505 to EmailInUseError (race path past the pre-check)", async () => {
    const email = uniqueEmail("dbrace");
    await usersRepo.createTenantAdminWithTenant({
      name: "First",
      email,
      passwordHash: "x",
    });
    await expect(
      usersRepo.createTenantAdminWithTenant({
        name: "Second",
        email,
        passwordHash: "x",
      }),
    ).rejects.toBeInstanceOf(EmailInUseError);
  });
});

describe("test_REQ_007_protected_route_401_without_cookie", () => {
  it("returns 401 without a cookie and 200 with a fresh session", async () => {
    const { app } = buildAuthApp();
    const noCookie = await app.request("/api/admin/probe");
    expect(noCookie.status).toBe(401);
    expect(await noCookie.json()).toEqual({ error: "unauthorized" });

    const tampered = await app.request("/api/admin/probe", {
      headers: { cookie: `${COOKIE_NAME}=tampered.cookie` },
    });
    expect(tampered.status).toBe(401);

    const email = uniqueEmail("gate");
    const signupRes = await signup(app, email);
    const ok = await app.request("/api/admin/probe", {
      headers: { cookie: cookieOf(signupRes) },
    });
    expect(ok.status).toBe(200);
  });
});

describe("login", () => {
  it("logs in with correct credentials and rejects wrong ones uniformly", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("login");
    await signup(app, email);

    const wrong = await postJson(app, "/api/auth/login", {
      email,
      password: "not-the-password",
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });

    const unknown = await postJson(app, "/api/auth/login", {
      email: uniqueEmail("ghost"),
      password: PASSWORD,
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "invalid_credentials" });

    const ok = await postJson(app, "/api/auth/login", {
      email,
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    const me = await app.request("/api/auth/me", {
      headers: { cookie: cookieOf(ok) },
    });
    expect(me.status).toBe(200);
  });
});

describe("test_REQ_004_password_reset_token_single_use", () => {
  it("resets via the emailed link exactly once, with no enumeration signal", async () => {
    const { app, sends, flushBackground } = buildAuthApp();
    const email = uniqueEmail("reset");
    await signup(app, email);

    // Unknown email: identical response, no email sent.
    const unknown = await postJson(app, "/api/auth/forgot-password", {
      email: uniqueEmail("ghost"),
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true });
    await flushBackground();
    expect(sends).toHaveLength(0);

    const known = await postJson(app, "/api/auth/forgot-password", { email });
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ ok: true });
    // Token mint + email happen off the response path (REQ-004 timing).
    await flushBackground();
    expect(sends).toHaveLength(1);

    const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(sends[0].text);
    if (!match) throw new Error(`no reset link in: ${sends[0].text}`);
    const token = match[1];

    const newPassword = "brand-new-pass-9";
    const reset = await postJson(app, "/api/auth/reset-password", {
      token,
      password: newPassword,
      confirmPassword: newPassword,
    });
    expect(reset.status).toBe(200);

    // New password works; old one does not.
    const okLogin = await postJson(app, "/api/auth/login", {
      email,
      password: newPassword,
    });
    expect(okLogin.status).toBe(200);
    const oldLogin = await postJson(app, "/api/auth/login", {
      email,
      password: PASSWORD,
    });
    expect(oldLogin.status).toBe(401);

    // Single use: the same token is now rejected.
    const reuse = await postJson(app, "/api/auth/reset-password", {
      token,
      password: "yet-another-pass-1",
      confirmPassword: "yet-another-pass-1",
    });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("rejects an expired token", async () => {
    const { app } = buildAuthApp();
    const email = uniqueEmail("expired");
    await signup(app, email);
    const user = await usersRepo.findByEmail(email);
    if (!user) throw new Error("missing user");

    const rawToken = "expired-token-raw";
    await resetRepo.create(
      user.id,
      createHash("sha256").update(rawToken).digest("hex"),
      new Date(Date.now() - 1000),
    );
    const res = await postJson(app, "/api/auth/reset-password", {
      token: rawToken,
      password: "whatever-pass-12",
      confirmPassword: "whatever-pass-12",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_or_expired" });
  });
});

describe("REQ-121: auth rate limiting", () => {
  it("throttles signup after the per-IP limit", async () => {
    const { app } = buildAuthApp({ signupLimiterMax: 2 });
    const headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          name: "E2E User",
          email: uniqueEmail("ratelimit"),
          password: PASSWORD,
          confirmPassword: PASSWORD,
        }),
      });
      expect(res.status).toBe(201);
    }
    const blocked = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        name: "E2E User",
        email: uniqueEmail("ratelimit"),
        password: PASSWORD,
        confirmPassword: PASSWORD,
      }),
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
