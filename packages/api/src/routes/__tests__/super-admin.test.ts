import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { TenantContext } from "@newsletter/shared/tenant";
import {
  createSuperAdminRouter,
  type SuperAdminRouterDeps,
} from "../super-admin.js";
import { verifySession, COOKIE_NAME } from "../../auth/session.js";
import type { TenantVariables } from "../../middleware/types.js";
import type { TenantsRepo, TenantListEntry } from "../../repositories/tenants.js";
import type { SubscribersRepo } from "../../repositories/subscribers.js";
import type { RunArchivesRepo, RunArchiveRow } from "../../repositories/run-archives.js";
import type { ImpersonationAuditRepo } from "../../repositories/impersonation-audit.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const SUPER_ADMIN_USER = "99999999-9999-9999-9999-999999999999";

function makeTenant(id: string, slug: string, name: string): TenantListEntry {
  return {
    id,
    slug,
    previousSlug: null,
    status: "active",
    name,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    logoVersion: 0,
    customDomain: `${slug}.example.com`,
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
    builtPageEnabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    userCount: 1,
  } as unknown as TenantListEntry;
}

function makeArchive(completedAt: Date): RunArchiveRow {
  return { id: "run", status: "completed", completedAt } as unknown as RunArchiveRow;
}

function makeDeps(overrides: Partial<SuperAdminRouterDeps> = {}): {
  deps: SuperAdminRouterDeps;
  audit: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
} {
  const start = vi.fn(() => Promise.resolve());
  const stop = vi.fn(() => Promise.resolve());
  const auditRepo: ImpersonationAuditRepo = {
    recordStart: start,
    recordStop: stop,
  };

  const tenantsRepo = {
    list: (): Promise<TenantListEntry[]> =>
      Promise.resolve([
        makeTenant(TENANT_A, "alpha", "Alpha"),
        makeTenant(TENANT_B, "beta", "Beta"),
      ]),
    getById: (id: string) =>
      Promise.resolve(
        id === TENANT_A ? makeTenant(TENANT_A, "alpha", "Alpha") : null,
      ),
  } as unknown as TenantsRepo;

  const subscribersRepo = (ctx: TenantContext): SubscribersRepo =>
    ({
      countConfirmed: () => Promise.resolve(ctx.tenantId === TENANT_A ? 10 : 3),
    }) as unknown as SubscribersRepo;

  const archiveRepo = (ctx: TenantContext): RunArchivesRepo =>
    ({
      list: () =>
        Promise.resolve(
          ctx.tenantId === TENANT_A
            ? [makeArchive(new Date("2026-06-01T12:00:00Z"))]
            : [],
        ),
    }) as unknown as RunArchivesRepo;

  const deps: SuperAdminRouterDeps = {
    sessionSecret: SESSION_SECRET,
    getTenantsRepo: () => tenantsRepo,
    getSubscribersRepo: subscribersRepo,
    getArchiveRepo: archiveRepo,
    getImpersonationAuditRepo: () => auditRepo,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    ...overrides,
  };
  return { deps, audit: { start, stop } };
}

function makeApp(deps: SuperAdminRouterDeps, ctx: TenantContext | null) {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("/api/super-admin/*", async (c, next) => {
    if (ctx) c.set("tenantCtx", ctx);
    await next();
  });
  app.route("/api/super-admin", createSuperAdminRouter(deps));
  return app;
}

describe("super-admin router gating", () => {
  it("403s when there is no tenant context", async () => {
    const { deps } = makeDeps();
    const app = makeApp(deps, null);
    const res = await app.request("/api/super-admin/tenants");
    expect(res.status).toBe(403);
  });

  it("403s for a tenant_admin (REQ-082)", async () => {
    const { deps } = makeDeps();
    const app = makeApp(deps, {
      tenantId: TENANT_A,
      userId: "u",
      role: "tenant_admin",
    });
    const res = await app.request("/api/super-admin/tenants");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/super-admin/tenants", () => {
  it("lists all tenants with status, subscriber count, and last run (F80)", async () => {
    const { deps } = makeDeps();
    const app = makeApp(deps, {
      tenantId: "",
      userId: SUPER_ADMIN_USER,
      role: "super_admin",
    });
    const res = await app.request("/api/super-admin/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: {
        id: string;
        status: string;
        subscriberCount: number;
        lastRunAt: string | null;
      }[];
    };
    expect(body.tenants).toHaveLength(2);
    const alpha = body.tenants.find((t) => t.id === TENANT_A);
    const beta = body.tenants.find((t) => t.id === TENANT_B);
    expect(alpha).toMatchObject({
      status: "active",
      subscriberCount: 10,
      lastRunAt: "2026-06-01T12:00:00.000Z",
    });
    expect(beta).toMatchObject({
      status: "active",
      subscriberCount: 3,
      lastRunAt: null,
    });
  });
});

describe("POST /api/super-admin/impersonate/:tenantId", () => {
  it("issues an impersonation session and audits the start (F81/F83)", async () => {
    const { deps, audit } = makeDeps();
    const app = makeApp(deps, {
      tenantId: "",
      userId: SUPER_ADMIN_USER,
      role: "super_admin",
    });
    const res = await app.request(`/api/super-admin/impersonate/${TENANT_A}`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenantId: TENANT_A });

    expect(audit.start).toHaveBeenCalledWith(SUPER_ADMIN_USER, TENANT_A);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    const token = /admin_session=([^;]+)/.exec(setCookie ?? "")?.[1] ?? "";
    const session = verifySession(decodeURIComponent(token), SESSION_SECRET);
    expect(session).toMatchObject({
      userId: SUPER_ADMIN_USER,
      tenantId: TENANT_A,
      role: "super_admin",
    });
  });

  it("404s for an unknown tenant", async () => {
    const { deps, audit } = makeDeps();
    const app = makeApp(deps, {
      tenantId: "",
      userId: SUPER_ADMIN_USER,
      role: "super_admin",
    });
    const res = await app.request(`/api/super-admin/impersonate/${TENANT_B}`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(audit.start).not.toHaveBeenCalled();
  });
});

describe("POST /api/super-admin/impersonate/exit", () => {
  it("clears impersonation and audits the stop (F82/F83)", async () => {
    const { deps, audit } = makeDeps();
    const app = makeApp(deps, {
      tenantId: TENANT_A,
      userId: SUPER_ADMIN_USER,
      role: "super_admin",
      impersonating: true,
    });
    const res = await app.request("/api/super-admin/impersonate/exit", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(audit.stop).toHaveBeenCalledWith(SUPER_ADMIN_USER, TENANT_A);

    const setCookie = res.headers.get("set-cookie");
    const token = /admin_session=([^;]+)/.exec(setCookie ?? "")?.[1] ?? "";
    const session = verifySession(decodeURIComponent(token), SESSION_SECRET);
    expect(session).toMatchObject({
      userId: SUPER_ADMIN_USER,
      tenantId: "",
      role: "super_admin",
    });
  });

  it("does not audit a stop when not impersonating", async () => {
    const { deps, audit } = makeDeps();
    const app = makeApp(deps, {
      tenantId: "",
      userId: SUPER_ADMIN_USER,
      role: "super_admin",
    });
    const res = await app.request("/api/super-admin/impersonate/exit", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(audit.stop).not.toHaveBeenCalled();
  });
});
