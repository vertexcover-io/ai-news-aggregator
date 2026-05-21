/**
 * E2E for admin auth router (VS-1, REQ-A1..A5).
 * Pure-Hono test — no Redis needed. Uses app.request(...) (Web-Fetch style).
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAdminRouter } from "@api/routes/admin.js";
import type { AdminRouterLogger } from "@api/routes/admin.js";

const ADMIN_PASSWORD = "test-pw";
const SESSION_SECRET = "test-secret-at-least-32-bytes-long-x";

function makeLogger(): AdminRouterLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

function buildApp(): Hono {
  const app = new Hono();
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

describe("POST /api/admin/login (e2e)", () => {
  it("REQ-A1: returns 200 + Set-Cookie for correct password", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie === null) throw new Error("missing Set-Cookie");
    expect(setCookie).toMatch(/^admin_session=[^;]+/);
  });

  it("REQ-A2: returns 401 for wrong password", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_password");
  });

  it("REQ-A3: returns 400 for empty-string password", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("REQ-A3: returns 400 for missing password field", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("REQ-A3: returns 400 for malformed JSON body", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });
});

describe("POST /api/admin/logout (e2e)", () => {
  it("REQ-A4: returns 200 + cookie-clearing Set-Cookie", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie === null) throw new Error("missing Set-Cookie");
    expect(setCookie).toContain("admin_session=");
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});

describe("GET /api/admin/me (e2e)", () => {
  it("REQ-A5: returns 200 with { admin: true }", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: boolean };
    expect(body.admin).toBe(true);
  });
});
