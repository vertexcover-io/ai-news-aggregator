/**
 * P6 — requireAuth + impersonation cookie (REQ-101, EDGE-008).
 *
 * While a super_admin session carries a valid impersonation cookie, the
 * request-scoped tenantCtx swaps to the acting tenant and is flagged
 * `impersonating`. The repo-scope bridge then yields a CONCRETE tenant-fenced
 * scope (never the withAllTenants escape hatch) — impersonation grants no
 * privilege beyond a tenant admin (EDGE-008).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireAuth, type TenantCtx } from "../middleware.js";
import { tenantScopeFromSession } from "../tenant-scope.js";
import {
  issueToken,
  issueImpersonationToken,
  COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
} from "../session.js";
import { isTenantContext } from "@newsletter/shared/types/tenant-context";

const SECRET = "p6-middleware-test-secret";
const SUPER_ID = "99999999-8888-7777-6666-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function probeApp(): Hono {
  const app = new Hono();
  app.get("/probe", requireAuth(SECRET), (c) =>
    c.json({ tenantCtx: c.get("tenantCtx") }),
  );
  return app;
}

function superSession(): string {
  return issueToken({ userId: SUPER_ID, tenantId: null, role: "super_admin" }, SECRET);
}

function impersonationCookie(userId = SUPER_ID): string {
  return issueImpersonationToken(
    { userId, role: "super_admin", actingTenantId: TENANT_ID, impersonating: true },
    SECRET,
  );
}

async function probe(cookies: string): Promise<{ status: number; tenantCtx?: TenantCtx }> {
  const res = await probeApp().request("/probe", { headers: { cookie: cookies } });
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json()) as { tenantCtx: TenantCtx };
  return { status: 200, tenantCtx: body.tenantCtx };
}

describe("requireAuth impersonation (REQ-101)", () => {
  it("test_REQ_101_impersonation_sets_acting_tenant", async () => {
    const { status, tenantCtx } = await probe(
      `${COOKIE_NAME}=${superSession()}; ${IMPERSONATION_COOKIE_NAME}=${impersonationCookie()}`,
    );
    expect(status).toBe(200);
    expect(tenantCtx).toEqual({
      userId: SUPER_ID, // original super-admin identity preserved (audit)
      tenantId: TENANT_ID,
      role: "super_admin",
      impersonating: true,
    });
  });

  it("ignores an impersonation cookie whose userId is not the session user", async () => {
    const { status, tenantCtx } = await probe(
      `${COOKIE_NAME}=${superSession()}; ${IMPERSONATION_COOKIE_NAME}=${impersonationCookie("11111111-2222-3333-4444-555555555555")}`,
    );
    expect(status).toBe(200);
    expect(tenantCtx?.tenantId).toBeNull();
    expect(tenantCtx?.impersonating).toBeUndefined();
  });

  it("ignores an impersonation cookie on a tenant_admin session", async () => {
    const tenantSession = issueToken(
      { userId: SUPER_ID, tenantId: "bbbbbbbb-0000-1111-2222-333333333333", role: "tenant_admin" },
      SECRET,
    );
    const { status, tenantCtx } = await probe(
      `${COOKIE_NAME}=${tenantSession}; ${IMPERSONATION_COOKIE_NAME}=${impersonationCookie()}`,
    );
    expect(status).toBe(200);
    expect(tenantCtx?.tenantId).toBe("bbbbbbbb-0000-1111-2222-333333333333");
    expect(tenantCtx?.impersonating).toBeUndefined();
  });

  it("rejects an impersonation cookie without a session cookie (401)", async () => {
    const { status } = await probe(
      `${IMPERSONATION_COOKIE_NAME}=${impersonationCookie()}`,
    );
    expect(status).toBe(401);
  });
});

describe("impersonated scope is tenant-fenced (EDGE-008)", () => {
  it("test_EDGE_008_impersonation_no_privilege_elevation", () => {
    const impersonated: TenantCtx = {
      userId: SUPER_ID,
      tenantId: TENANT_ID,
      role: "super_admin",
      impersonating: true,
    };
    const scope = tenantScopeFromSession(impersonated);
    // Concrete TenantContext — NOT the cross-tenant withAllTenants scope.
    expect(scope).toBeDefined();
    expect(isTenantContext(scope)).toBe(true);
    if (isTenantContext(scope)) {
      expect(scope.tenantId).toBe(TENANT_ID);
      expect(scope.impersonating).toBe(true);
    }
  });

  it("a non-impersonating super_admin session still gets the all-tenants scope", () => {
    const scope = tenantScopeFromSession({
      userId: SUPER_ID,
      tenantId: null,
      role: "super_admin",
    });
    expect(scope).toBeDefined();
    expect(isTenantContext(scope)).toBe(false);
  });
});
