import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAdminRouter } from "../admin.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";

const ADMIN_PASSWORD = "correct-horse-battery";
const SESSION_SECRET = "test-session-secret";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function makeAdminApp(logger = makeLogger()) {
  const app = new Hono();
  app.route(
    "/api/admin",
    createAdminRouter({
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: SESSION_SECRET,
      logger,
    }),
  );
  return { app, logger };
}

function makeProtectedApp() {
  const app = new Hono();
  app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  app.route(
    "/api/admin",
    createAdminRouter({
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: SESSION_SECRET,
      logger: makeLogger(),
    }),
  );
  return app;
}

describe("POST /api/admin/login", () => {
  it("returns 200 and sets admin_session cookie on correct password", async () => {
    const { app } = makeAdminApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it("returns 401 on wrong password with no Set-Cookie", async () => {
    const { app } = makeAdminApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_password" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("logs warn with ip/ua/timestamp on failed login", async () => {
    const { app, logger } = makeAdminApp();
    await app.request("/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1",
        "user-agent": "test-agent",
      },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const call = logger.warn.mock.calls[0] as [string, { ip: string; ua: string; timestamp: string }];
    expect(call[0]).toBe("admin_login_failed");
    expect(call[1]).toMatchObject({
      ip: "10.0.0.1",
      ua: "test-agent",
    });
    expect(typeof call[1].timestamp).toBe("string");
  });

  it.each<{ name: string; body?: string }>([
    { name: "missing body" },
    { name: "empty password", body: JSON.stringify({ password: "" }) },
    { name: "password field missing", body: JSON.stringify({}) },
  ])("returns 400 with invalid_body on $name", async ({ body }) => {
    const { app } = makeAdminApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("POST /api/admin/logout", () => {
  it("returns 200 and clears the admin_session cookie", async () => {
    const { app } = makeAdminApp();
    const res = await app.request("/api/admin/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});

describe("GET /api/admin/me behind requireAdmin", () => {
  it("returns 401 with no cookie", async () => {
    const app = makeProtectedApp();
    const res = await app.request("/api/admin/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 200 with a valid cookie", async () => {
    const app = makeProtectedApp();
    const token = issueToken(SESSION_SECRET);
    const res = await app.request("/api/admin/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it("returns 401 with a tampered cookie", async () => {
    const app = makeProtectedApp();
    const token = issueToken(SESSION_SECRET);
    const [issuedAt, mac] = token.split(".");
    const flipped = mac.startsWith("a") ? "b" + mac.slice(1) : "a" + mac.slice(1);
    const tampered = `${issuedAt}.${flipped}`;
    const res = await app.request("/api/admin/me", {
      headers: { cookie: `${COOKIE_NAME}=${tampered}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
