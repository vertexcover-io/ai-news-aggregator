import { Hono } from "hono";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { getTenantId } from "@api/middleware/tenant-host.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";

/**
 * AGENTLOOP-equivalent branding for tenant 0 when the branding columns are
 * still null (REQ-122 continuity — the legacy public site keeps rendering
 * unchanged until the migration seed backfills the row).
 */
export const TENANT_ZERO_BRANDING_DEFAULTS = {
  headline: "The daily read for people who ship with agents.",
  topicStrip:
    "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
  subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
} as const;

export interface TenantConfigWire {
  name: string;
  slug: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  flags: {
    canon: boolean;
    built: boolean;
    deliverability: boolean;
  };
}

export interface TenantConfigRouterDeps {
  tenantsRepo: Pick<TenantsRepo, "getBranding">;
}

export function createTenantConfigRouter(deps: TenantConfigRouterDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    // Host-resolved response on a shared path — shared caches must key on Host.
    c.header("Vary", "Host");
    const tenantId = getTenantId(c);
    const row = await deps.tenantsRepo.getBranding(tenantId);
    if (!row) return c.json({ error: "not_found" }, 404);

    const isTenantZero = row.id === TENANT_ZERO_ID;
    const defaults = isTenantZero ? TENANT_ZERO_BRANDING_DEFAULTS : null;
    const wire: TenantConfigWire = {
      name: row.name,
      slug: row.slug,
      headline: row.headline ?? defaults?.headline ?? null,
      topicStrip: row.topicStrip ?? defaults?.topicStrip ?? null,
      subtagline: row.subtagline ?? defaults?.subtagline ?? null,
      logoVersion: row.logoVersion,
      flags: {
        canon: row.canonEnabled,
        built: isTenantZero,
        deliverability: row.deliverabilityEnabled,
      },
    };
    return c.json(wire);
  });

  return app;
}

export interface TenantLogoRouterDeps {
  tenantsRepo: Pick<TenantsRepo, "getLogo">;
}

const LOGO_CACHE_CONTROL = "public, max-age=31536000, immutable";

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .includes(etag);
}

export function createTenantLogoRouter(deps: TenantLogoRouterDeps): Hono {
  const app = new Hono();

  // REQ-043: PG-stored bytes served with content-type + immutable caching;
  // the version-keyed ETag collapses repeat reads to 304s.
  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const logo = await deps.tenantsRepo.getLogo(tenantId);
    if (!logo) return c.json({ error: "not_found" }, 404);

    // Tenant-unique ETag + Vary:Host — this is one shared path resolved per
    // Host; without them a shared/CDN cache (or an If-None-Match revalidation)
    // can serve tenant A's bytes on tenant B's domain.
    const etag = `"${tenantId}-v${String(logo.logoVersion)}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", LOGO_CACHE_CONTROL);
    c.header("Vary", "Host");
    // User-uploaded bytes (incl. SVG) must never execute as a document in the
    // public origin: no sniffing, download-only on navigation, script-free CSP.
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", 'attachment; filename="logo"');
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304);
    }
    c.header("Content-Type", logo.contentType);
    return c.body(
      new Uint8Array(logo.logo.buffer, logo.logo.byteOffset, logo.logo.byteLength),
      200,
    );
  });

  return app;
}
