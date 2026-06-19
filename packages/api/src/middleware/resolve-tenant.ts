/**
 * Host→tenant resolution middleware (P5, REQ-020/021/022/023).
 *
 * Classifies the request Host into four classes:
 *   - app host      → admin/signup surface; tenant comes from the SESSION
 *                     (requireAuth sets `tenantCtx`), never from Host (REQ-020).
 *                     Marked with the `appHost` context flag so the public
 *                     CONTENT routes (home/archives/sources/must-read) can 404
 *                     there instead of falling through to the unscoped legacy
 *                     path that would merge every tenant's newsletter.
 *   - slug host     → `<slug>.<root>` public site; tenant looked up by slug;
 *                     unknown slug → generic 404, leaking nothing (REQ-021,
 *                     EDGE-013); a renamed tenant's old slug 301-redirects to
 *                     the new slug host (REQ-023, EDGE-002)
 *   - custom domain → hardcoded `host=slug` map (AGENTLOOP → tenant 0, REQ-022)
 *   - unknown       → generic 404 (typo subdomain / bare apex, EDGE-013)
 *
 * For public-site requests the resolved tenant is attached as a role-less
 * `publicTenant` context var — deliberately NOT the session `tenantCtx`, so a
 * public Host can never widen into an authenticated scope.
 */
import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";
import { normalizeHost, type DomainConfig } from "../config/domains.js";
import type { TenantsRepo } from "../repositories/tenants.js";

/** Role-less public tenant identity derived from the request Host. */
export interface PublicTenantCtx {
  tenantId: string;
  slug: string;
  /** Canon ("Must Read") feature flag — gates the public canon page + home block (Fix #4). */
  featureCanon: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    /** Set by `createResolveTenant` for slug-host / custom-domain requests. */
    publicTenant?: PublicTenantCtx;
    /**
     * Set by `createResolveTenant` for app-host requests (the platform
     * admin/signup surface). The app host has no public newsletter, so the
     * public content routes 404 when this is set (`blockPublicContentOnAppHost`)
     * rather than serving the unscoped, cross-tenant legacy result.
     */
    appHost?: boolean;
  }
}

export type HostClassification =
  | { kind: "app" }
  | { kind: "slug"; slug: string; redirectable: boolean }
  | { kind: "custom"; slug: string }
  | { kind: "unknown" };

export function classifyHost(
  hostHeader: string,
  headerSlugOverride: string | undefined,
  config: DomainConfig,
): HostClassification {
  // Dev-only escape hatch: target a tenant without DNS (X-Tenant-Slug).
  // Not redirectable — there is no slug host to rewrite in the Location.
  if (config.allowDevOverrides && headerSlugOverride) {
    return {
      kind: "slug",
      slug: headerSlugOverride.trim().toLowerCase(),
      redirectable: false,
    };
  }

  const host = normalizeHost(hostHeader);
  if (!host) return { kind: "unknown" };
  if (config.appHosts.has(host)) return { kind: "app" };

  const mappedSlug = config.customDomainMap.get(host);
  if (mappedSlug) return { kind: "custom", slug: mappedSlug };

  for (const root of config.rootDomains) {
    if (host === root) return { kind: "unknown" }; // bare apex (EDGE-013)
    if (host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1));
      // Only single-label subdomains are slugs; deeper nesting is unknown.
      if (label && !label.includes(".")) {
        return { kind: "slug", slug: label, redirectable: true };
      }
      return { kind: "unknown" };
    }
  }
  return { kind: "unknown" };
}

export interface ResolveTenantDeps {
  config: DomainConfig;
  getTenantsRepo: () => Pick<
    TenantsRepo,
    "findBySlug" | "findByPreviousSlug" | "findByCustomDomain"
  >;
  /** Now-ms source (injectable for tests); defaults to Date.now. */
  now?: () => number;
}

/** TTL for the custom-domain → tenant cache (verified domains change rarely). */
const CUSTOM_DOMAIN_CACHE_TTL_MS = 30_000;

/** Identical body for every unknown class — leaks nothing (EDGE-013). */
const notFound = (c: Context): Response => c.json({ error: "not_found" }, 404);

export function createResolveTenant(deps: ResolveTenantDeps): MiddlewareHandler {
  const now = deps.now ?? Date.now;
  // Per-instance cache: a verified custom host → its public tenant (or null
  // for a miss), so the DB isn't hit on every request to a custom domain.
  const customDomainCache = new Map<
    string,
    { value: PublicTenantCtx | null; expires: number }
  >();

  async function resolveCustomDomain(
    host: string,
  ): Promise<PublicTenantCtx | null> {
    if (!host) return null;
    const cached = customDomainCache.get(host);
    if (cached && cached.expires > now()) return cached.value;

    const tenant = await deps.getTenantsRepo().findByCustomDomain(host);
    const value: PublicTenantCtx | null =
      tenant !== null && tenant.status === "active"
        ? {
            tenantId: tenant.id,
            slug: tenant.slug,
            featureCanon: tenant.featureCanon,
          }
        : null;
    customDomainCache.set(host, {
      value,
      expires: now() + CUSTOM_DOMAIN_CACHE_TTL_MS,
    });
    return value;
  }

  return createMiddleware(async (c, next) => {
    const hostHeader = c.req.header("host") ?? new URL(c.req.url).host;
    const classification = classifyHost(
      hostHeader,
      c.req.header("x-tenant-slug"),
      deps.config,
    );

    if (classification.kind === "app") {
      // Tenant comes from the session, never Host (REQ-020). Flag the request
      // so public CONTENT routes return a generic 404 here instead of the
      // unscoped legacy result that would leak every tenant's newsletter.
      c.set("appHost", true);
      await next();
      return;
    }
    if (classification.kind === "unknown") {
      // Not the app host, not the env custom map, not `<slug>.<root>`: it may
      // be a tenant's VERIFIED own web domain (Fix #3, Phase C). DB-resolve it
      // (cached); only verified domains resolve (findByCustomDomain filters).
      const host = normalizeHost(hostHeader);
      const resolved = await resolveCustomDomain(host);
      if (resolved !== null) {
        c.set("publicTenant", resolved);
        await next();
        return;
      }
      return notFound(c);
    }

    const repo = deps.getTenantsRepo();
    const tenant = await repo.findBySlug(classification.slug);
    if (tenant !== null) {
      // Only ACTIVE tenants have a public site (P11, REQ-031/035): a
      // pending_setup tenant's host serves the same generic 404 as an
      // unknown slug until the onboarding wizard activates it.
      if (tenant.status !== "active") return notFound(c);
      c.set("publicTenant", {
        tenantId: tenant.id,
        slug: tenant.slug,
        featureCanon: tenant.featureCanon,
      });
      await next();
      return;
    }

    // Slug miss: the tenant may have been renamed (REQ-023, EDGE-002).
    const renamed = await repo.findByPreviousSlug(classification.slug);
    if (renamed !== null) {
      if (renamed.status !== "active") return notFound(c);
      if (classification.kind === "slug" && classification.redirectable) {
        return c.redirect(
          slugRedirectUrl(c, classification.slug, renamed.slug),
          301,
        );
      }
      // Custom domain whose configured slug went stale after a rename:
      // still serve the tenant — the domain itself did not change.
      c.set("publicTenant", {
        tenantId: renamed.id,
        slug: renamed.slug,
        featureCanon: renamed.featureCanon,
      });
      await next();
      return;
    }

    return notFound(c);
  });
}

/**
 * Guard for PUBLIC CONTENT routes (home / public archives + search / sources
 * summary / must-read). On the app host there is no public newsletter, so the
 * `appHost` flag set by {@link createResolveTenant} makes this return a generic
 * 404 — never the unscoped, all-tenants legacy result. Tenant hosts (publicTenant
 * set) and genuine legacy single-tenant deployments (resolver not mounted, so no
 * flag) pass straight through, unchanged.
 */
export const blockPublicContentOnAppHost: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    if (c.get("appHost") === true) return notFound(c);
    await next();
  },
);

/**
 * Rebuilds the request URL on `<newSlug>.<root>`, preserving path, query and
 * port so in-flight links/emails survive a rename (EDGE-002).
 */
function slugRedirectUrl(c: Context, oldSlug: string, newSlug: string): string {
  const url = new URL(c.req.url);
  const hostHeader = c.req.header("host");
  if (hostHeader) {
    // Behind proxies the URL host can differ from the Host header; trust the
    // header — it is what classification ran against.
    const [, port] = splitHostPort(hostHeader);
    url.host = port ? `${normalizeHost(hostHeader)}:${port}` : normalizeHost(hostHeader);
  }
  url.hostname = `${newSlug}${url.hostname.slice(oldSlug.length)}`;
  const forwardedProto = c.req.header("x-forwarded-proto");
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }
  return url.toString();
}

function splitHostPort(raw: string): [string, string | undefined] {
  const trimmed = raw.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1 || trimmed.endsWith("]")) return [trimmed, undefined];
  const port = trimmed.slice(colon + 1);
  return /^\d+$/.test(port) ? [trimmed.slice(0, colon), port] : [trimmed, undefined];
}
