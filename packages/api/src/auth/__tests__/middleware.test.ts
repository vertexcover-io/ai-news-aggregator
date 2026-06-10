import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import {
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
  issueToken,
  issueImpersonationToken,
  verifySessionToken,
  verifyImpersonationToken,
} from "../session.js";
import { requireAuth, requireImpersonation, requireSuperAdmin } from "../middleware.js";
import type { SessionPayload } from "../session.js";

const SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

function makeAppWithAuth(secret: string): Hono {
  const app = new Hono();
  app.use("*", requireAuth(secret));
  app.get("/me", (c) => {
    const ctx = c.get("tenantCtx");
    return c.json(ctx);
  });
  return app;
}

function makeAppWithImpersonation(secret: string): Hono {
  const app = new Hono();
  // requireAuth runs first to populate tenantCtx from session cookie
  app.use("*", requireAuth(secret));
  // requireImpersonation runs after: reads impersonation cookie and swaps tenantCtx
  app.use("*", requireImpersonation(secret));
  app.get("/me", (c) => {
    const ctx = c.get("tenantCtx");
    return c.json(ctx);
  });
  return app;
}

function makeSuperApp(secret: string): Hono {
  const app = new Hono();
  app.use("*", requireAuth(secret));
  app.use("*", requireSuperAdmin());
  app.get("/super-only", (c) => c.json({ ok: true }));
  return app;
}

describe("requireAuth", () => {
  it("returns 401 when no cookie is present", async () => {
    const app = makeAppWithAuth(SECRET);
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const app = makeAppWithAuth(SECRET);
    const res = await app.request("/me", {
      headers: { cookie: `${COOKIE_NAME}=garbage.token` },
    });
    expect(res.status).toBe(401);
  });

  it("populates tenantCtx from a valid V2 session token", async () => {
    const payload: SessionPayload = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "tenant_admin",
    };
    const token = issueToken(SECRET, payload);

    const app = makeAppWithAuth(SECRET);
    const res = await app.request("/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionPayload;
    expect(body.userId).toBe("user-1");
    expect(body.tenantId).toBe("tenant-1");
    expect(body.role).toBe("tenant_admin");
  });

  it("sets default tenantCtx for legacy tokens", async () => {
    const token = issueToken(SECRET);

    const app = makeAppWithAuth(SECRET);
    const res = await app.request("/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionPayload;
    expect(body.role).toBe("tenant_admin");
  });
});

describe("requireImpersonation — REQ-101", () => {
  it("test_REQ_101_impersonation_swaps_tenant_context", async () => {
    // Set up a super_admin session cookie
    const sessionPayload: SessionPayload = {
      userId: "super-user-1",
      tenantId: "app-tenant",
      role: "super_admin",
    };
    const sessionToken = issueToken(SECRET, sessionPayload);

    // Set up an impersonation cookie pointing to a target tenant
    const impToken = issueImpersonationToken(SECRET, {
      userId: "super-user-1",
      actingTenantId: "tenant-target-42",
    });

    const app = makeAppWithImpersonation(SECRET);
    const cookieHeader = `${COOKIE_NAME}=${sessionToken}; ${IMPERSONATION_COOKIE_NAME}=${impToken}`;
    const res = await app.request("/me", {
      headers: { cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The tenantCtx should reflect the impersonated tenant, preserving
    // original userId and role but with actingTenantId as tenantId
    expect(body.userId).toBe("super-user-1");
    expect(body.tenantId).toBe("tenant-target-42");
    expect(body.impersonating).toBe(true);
  });

  it("impersonation middleware is no-op when no impersonation cookie", async () => {
    const sessionPayload: SessionPayload = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "tenant_admin",
    };
    const token = issueToken(SECRET, sessionPayload);

    const app = makeAppWithImpersonation(SECRET);
    const res = await app.request("/me", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // No impersonation cookie → tenantCtx unchanged
    expect(body.tenantId).toBe("tenant-1");
    expect(body.impersonating).toBeUndefined();
  });

  it("impersonation with expired token falls back to session auth", async () => {
    const sessionPayload: SessionPayload = {
      userId: "super-user-1",
      tenantId: "app-tenant",
      role: "super_admin",
    };
    const sessionToken = issueToken(SECRET, sessionPayload);

    // Create an expired impersonation token
    const expiredImp = issueImpersonationToken(
      SECRET,
      { userId: "super-user-1", actingTenantId: "tenant-target-42" },
      Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    );

    const app = makeAppWithImpersonation(SECRET);
    const cookieHeader = `${COOKIE_NAME}=${sessionToken}; ${IMPERSONATION_COOKIE_NAME}=${expiredImp}`;
    const res = await app.request("/me", {
      headers: { cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Should fall back to the session user (super_admin, no impersonation)
    expect(body.role).toBe("super_admin");
    expect(body.impersonating).toBeUndefined();
  });
});

describe("requireSuperAdmin — EDGE-008", () => {
  it("test_EDGE_008_super_admin_routes_block_tenant_admin", async () => {
    const payload: SessionPayload = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "tenant_admin",
    };
    const token = issueToken(SECRET, payload);

    const app = makeSuperApp(SECRET);
    const res = await app.request("/super-only", {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("test_EDGE_008_impersonated_session_blocked_from_super_routes", async () => {
    // A super_admin who sets an impersonation cookie will have their
    // tenantCtx swapped to tenant_admin by requireImpersonation.
    // When they then hit a super-admin route, requireSuperAdmin should
    // see role !== "super_admin" and return 403 — no privilege elevation.

    const sessionPayload: SessionPayload = {
      userId: "super-user-1",
      tenantId: "app-tenant",
      role: "super_admin",
    };
    const sessionToken = issueToken(SECRET, sessionPayload);

    const impToken = issueImpersonationToken(SECRET, {
      userId: "super-user-1",
      actingTenantId: "tenant-target-42",
    });

    // Build app with auth + impersonation + super-admin gating
    const app = new Hono();
    app.use("*", requireAuth(SECRET));
    app.use("*", requireImpersonation(SECRET));
    app.use("*", requireSuperAdmin());
    app.get("/super-only", (c) => c.json({ ok: true }));

    const cookieHeader = `${COOKIE_NAME}=${sessionToken}; ${IMPERSONATION_COOKIE_NAME}=${impToken}`;
    const res = await app.request("/super-only", {
      headers: { cookie: cookieHeader },
    });
    expect(res.status).toBe(403);
  });
});
