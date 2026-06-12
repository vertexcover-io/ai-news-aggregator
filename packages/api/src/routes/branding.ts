/**
 * Public tenant branding routes (P7, REQ-040/043).
 *
 *   GET /api/branding       → TenantBranding wire payload for the
 *                             Host-resolved tenant (`publicTenant`, set by
 *                             the P5 resolver). On the app host / local dev
 *                             no public tenant is resolved — fall back to
 *                             tenant 0 (AGENTLOOP) so the legacy single-host
 *                             deployment keeps rendering its own brand.
 *   GET /api/branding/logo  → the tenant's Postgres-stored logo bytes with
 *                             correct Content-Type, a long-lived immutable
 *                             Cache-Control and a content-hash ETag
 *                             (REQ-043). The branding payload links here via
 *                             a `?v=<hash>` versioned URL, so the immutable
 *                             cache entry self-busts when the logo changes.
 *
 * Never serializes logo bytes (or any secret) into the JSON payload — bytes
 * only ever leave through the dedicated logo response.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { TENANT_ZERO_SLUG } from "@newsletter/shared/constants/tenant";
import {
  createTenantsRepo,
  type TenantRow,
  type TenantsRepo,
} from "@api/repositories/tenants.js";

export interface BrandingRouterDeps {
  getTenantsRepo: () => Pick<TenantsRepo, "findById" | "findBySlug">;
  logger?: ReturnType<typeof createLogger>;
}

function logoHash(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

async function resolveBrandingTenant(
  c: Context,
  deps: BrandingRouterDeps,
): Promise<TenantRow | null> {
  const repo = deps.getTenantsRepo();
  const publicTenant = c.get("publicTenant");
  if (publicTenant) return repo.findById(publicTenant.tenantId);
  // App host / local dev: no Host-derived tenant — serve tenant 0's brand.
  return repo.findBySlug(TENANT_ZERO_SLUG);
}

export function toBrandingWire(tenant: TenantRow): TenantBranding {
  const hasLogo = tenant.logoBytes !== null && tenant.logoContentType !== null;
  return {
    name: tenant.name,
    headline: tenant.headline,
    topicStrip: tenant.topicStrip,
    subtagline: tenant.subtagline,
    logoUrl:
      hasLogo && tenant.logoBytes !== null
        ? `/api/branding/logo?v=${logoHash(tenant.logoBytes).slice(0, 16)}`
        : null,
    flags: { canon: tenant.featureCanon },
    isTenantZero: tenant.slug === TENANT_ZERO_SLUG,
  };
}

export function createBrandingRouter(deps: BrandingRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:branding");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const tenant = await resolveBrandingTenant(c, deps);
      if (tenant === null) return c.json({ error: "not_found" }, 404);
      return c.json(toBrandingWire(tenant));
    } catch (err) {
      logger.error({ err }, "branding.fetch_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  app.get("/logo", async (c) => {
    try {
      const tenant = await resolveBrandingTenant(c, deps);
      if (tenant?.logoBytes == null || tenant.logoContentType === null) {
        return c.json({ error: "not_found" }, 404);
      }
      const etag = `"${logoHash(tenant.logoBytes)}"`;
      c.header("ETag", etag);
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      if (c.req.header("if-none-match") === etag) {
        return c.body(null, 304);
      }
      c.header("Content-Type", tenant.logoContentType);
      return c.body(new Uint8Array(tenant.logoBytes));
    } catch (err) {
      logger.error({ err }, "branding.logo_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return app;
}

export function createDefaultBrandingRouter(): Hono {
  return createBrandingRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
  });
}
