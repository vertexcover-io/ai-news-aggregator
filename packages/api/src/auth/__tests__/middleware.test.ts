import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AuthContext } from "@newsletter/shared";
import { requireUser, requireSuperAdmin, type AuthEnv } from "../middleware.js";
import { issueSession, COOKIE_NAME } from "../session.js";

const SECRET = "test-secret-please-rotate";
const UID = "11111111-1111-1111-1111-111111111111";
const TID = "22222222-2222-2222-2222-222222222222";
const IMP = "33333333-3333-3333-3333-333333333333";

function makeApp(gate: "user" | "super"): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(
    "*",
    gate === "user" ? requireUser(SECRET) : requireSuperAdmin(SECRET),
  );
  app.get("/whoami", (c) => c.json(c.get("auth")));
  return app;
}

function cookieFor(claims: Parameters<typeof issueSession>[0]): string {
  return `${COOKIE_NAME}=${issueSession(claims, SECRET)}`;
}

describe("requireUser", () => {
  it("test_REQ_007_protected_route_401_without_cookie", async () => {
    const res = await makeApp("user").request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for an invalid cookie", async () => {
    const res = await makeApp("user").request("/whoami", {
      headers: { cookie: `${COOKIE_NAME}=garbage.token` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a legacy admin_session cookie", async () => {
    const res = await makeApp("user").request("/whoami", {
      headers: { cookie: `admin_session=${Date.now()}.deadbeef` },
    });
    expect(res.status).toBe(401);
  });

  it("sets the auth context for a tenant_admin", async () => {
    const res = await makeApp("user").request("/whoami", {
      headers: {
        cookie: cookieFor({ uid: UID, tid: TID, role: "tenant_admin" }),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: UID,
      role: "tenant_admin",
      tenantId: TID,
      realTenantId: TID,
      impersonating: false,
    } satisfies AuthContext);
  });

  it("resolves tenantId to the impersonated tenant", async () => {
    const res = await makeApp("user").request("/whoami", {
      headers: {
        cookie: cookieFor({
          uid: UID,
          tid: null,
          role: "super_admin",
          imp: IMP,
        }),
      },
    });
    expect(await res.json()).toEqual({
      userId: UID,
      role: "super_admin",
      tenantId: IMP,
      realTenantId: null,
      impersonating: true,
    } satisfies AuthContext);
  });
});

describe("requireSuperAdmin", () => {
  it("returns 401 without a cookie", async () => {
    const res = await makeApp("super").request("/whoami");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a tenant_admin", async () => {
    const res = await makeApp("super").request("/whoami", {
      headers: {
        cookie: cookieFor({ uid: UID, tid: TID, role: "tenant_admin" }),
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("passes for a super_admin", async () => {
    const res = await makeApp("super").request("/whoami", {
      headers: {
        cookie: cookieFor({ uid: UID, tid: null, role: "super_admin" }),
      },
    });
    expect(res.status).toBe(200);
  });

  // REQ-101/102: the role claim is untouched by impersonation, so super-admin
  // surfaces (tenant list, exit-impersonation) stay reachable mid-impersonation.
  it("passes for a super_admin while impersonating", async () => {
    const res = await makeApp("super").request("/whoami", {
      headers: {
        cookie: cookieFor({
          uid: UID,
          tid: null,
          role: "super_admin",
          imp: IMP,
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: UID,
      role: "super_admin",
      tenantId: IMP,
      realTenantId: null,
      impersonating: true,
    } satisfies AuthContext);
  });
});
