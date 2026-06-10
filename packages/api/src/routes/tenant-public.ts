import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared/tenant";
import type { TenantContext } from "@newsletter/shared/tenant";
import type { TenantRow } from "@newsletter/shared";
import type { TenantVariables } from "@api/middleware/types.js";
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";

const LOGO_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface TenantBrandingPayload {
  readonly name: string | null;
  readonly headline: string | null;
  readonly topicStrip: string | null;
  readonly subtagline: string | null;
  readonly logoVersion: number;
  readonly hasLogo: boolean;
  readonly nav: {
    readonly sources: boolean;
    readonly mustRead: boolean;
    readonly built: boolean;
  };
}

export interface TenantPublicRouterDeps {
  getTenantsRepo: () => TenantsRepo;
  logger?: ReturnType<typeof createLogger>;
}

function toBrandingPayload(tenant: TenantRow): TenantBrandingPayload {
  return {
    name: tenant.name,
    headline: tenant.headline,
    topicStrip: tenant.topicStrip,
    subtagline: tenant.subtagline,
    logoVersion: tenant.logoVersion,
    hasLogo: tenant.logoBytes != null,
    nav: {
      sources: true,
      mustRead: tenant.canonEnabled,
      built: tenant.id === AGENTLOOP_TENANT_ID,
    },
  };
}

function logoEtag(tenant: TenantRow): string {
  return `"logo-${tenant.id}-${tenant.logoVersion}"`;
}

export function createTenantPublicRouter(deps: TenantPublicRouterDeps): Hono<{
  Variables: TenantVariables;
}> {
  const logger = deps.logger ?? createLogger("api:tenant-public");
  const app = new Hono<{ Variables: TenantVariables }>();

  const resolveTenant = async (
    ctx: TenantContext | undefined,
    slug: string | undefined,
  ): Promise<TenantRow | null> => {
    const repo = deps.getTenantsRepo();
    if (ctx) return repo.getById(ctx.tenantId);
    if (slug) return repo.getBySlug(slug);
    return null;
  };

  app.get("/branding", async (c) => {
    try {
      const tenant = await resolveTenant(c.get("tenantCtx"), c.get("tenantSlug"));
      if (!tenant) return c.json({ error: "not found" }, 404);
      return c.json(toBrandingPayload(tenant));
    } catch (err) {
      logger.error({ err }, "tenant_public.branding_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  app.get("/logo", async (c) => {
    try {
      const tenant = await resolveTenant(c.get("tenantCtx"), c.get("tenantSlug"));
      if (tenant?.logoBytes == null || tenant.logoContentType == null) {
        return c.json({ error: "not found" }, 404);
      }

      const etag = logoEtag(tenant);
      if (c.req.header("if-none-match") === etag) {
        c.header("ETag", etag);
        c.header("Cache-Control", LOGO_CACHE_CONTROL);
        return c.body(null, 304);
      }

      const bytes = Buffer.from(tenant.logoBytes, "base64");
      c.header("Content-Type", tenant.logoContentType);
      c.header("Cache-Control", LOGO_CACHE_CONTROL);
      c.header("ETag", etag);
      return c.body(bytes, 200);
    } catch (err) {
      logger.error({ err }, "tenant_public.logo_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return app;
}

export function createDefaultTenantPublicRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createTenantPublicRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
  });
}
