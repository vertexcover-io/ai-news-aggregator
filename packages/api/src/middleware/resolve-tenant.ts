/**
 * Host-to-tenant resolution middleware.
 *
 * Classifies incoming requests into four categories based on the Host header
 * (or X-Tenant-Slug dev override), then resolves the active tenant:
 *
 *   Class           | Condition                 | Tenant from
 *   ─────────────── | ───────────────────────── | ─────────────────────
 *   app-host        | Host === APP_HOST         | Session cookie (passthrough)
 *   custom-domain   | Host in CUSTOM_DOMAIN_MAP | Map or DB custom_domain
 *   slug-host       | Host = <slug>.<root>      | DB lookup by slug
 *   old-slug         | old_slug matches Host     | 301 → new slug
 *   dev override    | X-Tenant-Slug header      | DB lookup by slug
 *   unknown         | none of the above         | 404 not-found
 *
 * For app-host requests, this middleware is a no-op — the tenant is derived
 * from the session cookie by requireAuth / requireAdmin later.
 *
 * For all other host classes, the middleware populates c.var.tenantCtx with
 * a public (role-less) context: { tenantId, role: "public" }.
 *
 * REQ-020, REQ-021, REQ-022, REQ-023, EDGE-013.
 */

import { createMiddleware } from "hono/factory";
import type { TenantsRepo } from "../repositories/tenants.js";
import type { TenantContext } from "@newsletter/shared/services";
import {
  CUSTOM_TENANT_0_SENTINEL,
} from "../config/domains.js";

/**
 * Extract the bare host (no port) from a request, handling proxies.
 */
function getHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "";
  }
}

/**
 * Extract the subdomain (slug) from a slug-type host.
 * e.g. "testco.vertexcover.io" → "testco"
 * Returns null if the host does not end with the root domain or is the app host.
 */
function extractSlugFromHost(
  host: string,
  appHost: string,
  rootDomain: string,
): string | null {
  if (host === appHost) return null;
  if (host === rootDomain) return null;
  if (host.endsWith(`.${rootDomain}`)) {
    return host.slice(0, host.length - rootDomain.length - 1);
  }
  return null;
}

export interface ResolveTenantDeps {
  tenantsRepo: TenantsRepo;
  appHost: string;
  rootDomain: string;
  customDomainMap: Record<string, string>;
}

/** Sentinel slug for the AGENTLOOP tenant (tenant 0). */
const AGENTLOOP_SLUG = "agentloop";

export function createResolveTenant(deps: ResolveTenantDeps) {
  return createMiddleware(async (c, next) => {
    const host = getHost(c.req.url);

    // ── Dev override: X-Tenant-Slug header ──────────────────────────
    // Dev-only: X-Tenant-Slug bypasses DNS for local dev / e2e testing.
    // Never active in production — gated by NODE_ENV.
    const devSlug = process.env.NODE_ENV !== "production"
      ? c.req.header("x-tenant-slug")?.toLowerCase() ?? null
      : null;
    if (devSlug) {
      // Check old slug first
      const oldTenant = await deps.tenantsRepo.findByOldSlug(devSlug);
      if (oldTenant) {
        // Build the target URL with the new slug and the same path
        const u = new URL(c.req.url);
        u.hostname = `${oldTenant.slug}.${deps.rootDomain}`;
        return c.redirect(u.toString(), 301);
      }

      const tenant = await deps.tenantsRepo.findBySlug(devSlug);
      if (!tenant) {
        return c.json({ error: "Not Found" }, 404);
      }
      setPublicTenantCtx(c, tenant.id);
      await next();
      return;
    }

    // ── Classify the host ───────────────────────────────────────────
    const isAppHost = host === deps.appHost;

    // localhost is always a passthrough for dev/test — the resolver
    // does not try to classify it as a slug or custom domain.
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      await next();
      return;
    }

    const customDomainValue = deps.customDomainMap[host] ?? null;

    // ── App host: passthrough, auth middleware sets tenantCtx ────────
    if (isAppHost) {
      await next();
      return;
    }

    // ── Custom domain: mapped or DB-stored per-tenant ───────────────
    if (customDomainValue) {
      if (customDomainValue === CUSTOM_TENANT_0_SENTINEL) {
        // AGENTLOOP special case — find tenant by the well-known slug
        const tenant = await deps.tenantsRepo.findBySlug(AGENTLOOP_SLUG);
        if (tenant) {
          setPublicTenantCtx(c, tenant.id);
          await next();
          return;
        }
      }
      // Unrecognized sentinel — fall through to not-found
    }

    // Try DB-backed custom domain (tenant.custom_domain column)
    const customDomainTenant = await deps.tenantsRepo.findByCustomDomain(host);
    if (customDomainTenant) {
      setPublicTenantCtx(c, customDomainTenant.id);
      await next();
      return;
    }

    // ── Slug host: extract subdomain, look up ──────────────────────
    const slug = extractSlugFromHost(host, deps.appHost, deps.rootDomain);
    if (slug) {
      // Check old slug first (301 redirect)
      const oldTenant = await deps.tenantsRepo.findByOldSlug(slug);
      if (oldTenant) {
        const u = new URL(c.req.url);
        u.hostname = `${oldTenant.slug}.${deps.rootDomain}`;
        return c.redirect(u.toString(), 301);
      }

      const tenant = await deps.tenantsRepo.findBySlug(slug);
      if (tenant) {
        setPublicTenantCtx(c, tenant.id);
        await next();
        return;
      }
    }

    // ── Unknown host → 404 (EDGE-013: no tenant data leak) ─────────
    return c.json({ error: "Not Found" }, 404);
  });
}

/** Populate c.var.tenantCtx for public (unauthenticated) routes. */
function setPublicTenantCtx(
  c: { set: (key: "tenantCtx", value: TenantContext) => void },
  tenantId: string,
): void {
  c.set("tenantCtx", {
    tenantId,
    role: "public", // unauthenticated public context — no session cookie
  });
}
