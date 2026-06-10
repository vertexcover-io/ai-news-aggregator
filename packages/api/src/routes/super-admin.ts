import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/tenant";
import {
  issueSession,
  COOKIE_NAME,
  MAX_AGE_MS,
} from "@api/auth/session.js";
import type { TenantVariables } from "@api/middleware/types.js";
import { requireSuperAdmin } from "@api/middleware/require-super-admin.js";
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";
import {
  createSubscribersRepo,
  type SubscribersRepo,
} from "@api/repositories/subscribers.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createImpersonationAuditRepo,
  type ImpersonationAuditRepo,
} from "@api/repositories/impersonation-audit.js";

export interface SuperAdminRouterDeps {
  sessionSecret: string;
  getTenantsRepo: () => TenantsRepo;
  getSubscribersRepo: (ctx: TenantContext) => SubscribersRepo;
  getArchiveRepo: (ctx: TenantContext) => RunArchivesRepo;
  getImpersonationAuditRepo: () => ImpersonationAuditRepo;
  logger?: ReturnType<typeof createLogger>;
}

export interface SuperAdminTenantListEntry {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  customDomain: string | null;
  userCount: number;
  subscriberCount: number;
  lastRunAt: string | null;
}

function systemTenantContext(tenantId: string): TenantContext {
  return { tenantId, role: "super_admin" };
}

function setImpersonationCookie(
  c: Context<{ Variables: TenantVariables }>,
  secret: string,
  payload: {
    userId: string;
    tenantId: string;
    role: "super_admin";
    impersonating: boolean;
  },
): void {
  // `impersonating` is carried in the cookie so the middleware can surface it
  // on the resolved TenantContext (SessionPayload models it + verifySession
  // round-trips it).
  const token = issueSession(payload, secret);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
    secure: process.env.NODE_ENV === "production",
  });
}

export function createSuperAdminRouter(
  deps: SuperAdminRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const logger = deps.logger ?? createLogger("api:super-admin");
  const app = new Hono<{ Variables: TenantVariables }>();

  app.use("*", requireSuperAdmin());

  // F80 / REQ-100: super-admin landing is the tenant list. This is a
  // deliberate cross-tenant read, allowed only for super_admin.
  app.get("/tenants", async (c) => {
    const tenants = await deps.getTenantsRepo().list();
    const entries: SuperAdminTenantListEntry[] = [];
    for (const tenant of tenants) {
      const ctx = systemTenantContext(tenant.id);
      const subscriberCount = await deps.getSubscribersRepo(ctx).countConfirmed();
      const recentRuns = await deps.getArchiveRepo(ctx).list(1);
      const lastRunAt =
        recentRuns.length > 0
          ? recentRuns[0].completedAt.toISOString()
          : null;
      entries.push({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        customDomain: tenant.customDomain,
        userCount: tenant.userCount,
        subscriberCount,
        lastRunAt,
      });
    }
    return c.json({ tenants: entries });
  });

  // F82 / REQ-102 / REQ-103: exit impersonation back to the super-admin session.
  // Registered before the `:tenantId` route so "exit" is never matched as an id.
  app.post("/impersonate/exit", async (c) => {
    const actor = c.get("tenantCtx");
    if (!actor?.userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    setImpersonationCookie(c, deps.sessionSecret, {
      userId: actor.userId,
      tenantId: "",
      role: "super_admin",
      impersonating: false,
    });

    if (actor.impersonating) {
      await deps
        .getImpersonationAuditRepo()
        .recordStop(actor.userId, actor.tenantId);
    }
    logger.info(
      { event: "impersonate.exit", actingUserId: actor.userId },
      "impersonate.exit",
    );
    return c.json({ ok: true });
  });

  // F81 / F83 / REQ-101 / REQ-103: enter impersonation. Issue a session whose
  // effective tenant is the target; role stays super_admin; impersonating=true.
  app.post("/impersonate/:tenantId", async (c) => {
    const actor = c.get("tenantCtx");
    if (!actor?.userId) {
      return c.json({ error: "forbidden" }, 403);
    }
    const tenantId = c.req.param("tenantId");
    const tenant = await deps.getTenantsRepo().getById(tenantId);
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }

    setImpersonationCookie(c, deps.sessionSecret, {
      userId: actor.userId,
      tenantId: tenant.id,
      role: "super_admin",
      impersonating: true,
    });

    await deps.getImpersonationAuditRepo().recordStart(actor.userId, tenant.id);
    logger.info(
      { event: "impersonate.start", actingUserId: actor.userId, tenantId: tenant.id },
      "impersonate.start",
    );
    return c.json({ ok: true, tenantId: tenant.id });
  });

  return app;
}

export function createDefaultSuperAdminRouter(
  sessionSecret: string,
): Hono<{ Variables: TenantVariables }> {
  return createSuperAdminRouter({
    sessionSecret,
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    getSubscribersRepo: (ctx) => createSubscribersRepo(defaultGetDb(), ctx),
    getArchiveRepo: (ctx) => createRunArchivesRepo(defaultGetDb(), ctx),
    getImpersonationAuditRepo: () =>
      createImpersonationAuditRepo(defaultGetDb()),
  });
}
