/**
 * Host→tenant resolution middleware (P5, REQ-020/021/022/023).
 *
 * Classifies the request Host into four classes:
 *   - app host      → admin/signup surface; tenant comes from the SESSION
 *                     (requireAuth sets `tenantCtx`), never from Host (REQ-020)
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
}

declare module "hono" {
  interface ContextVariableMap {
    /** Set by `createResolveTenant` for slug-host / custom-domain requests. */
    publicTenant?: PublicTenantCtx;
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
  getTenantsRepo: () => Pick<TenantsRepo, "findBySlug" | "findByPreviousSlug">;
}

/** Identical body for every unknown class — leaks nothing (EDGE-013). */
const notFound = (c: Context): Response => c.json({ error: "not_found" }, 404);

export function createResolveTenant(deps: ResolveTenantDeps): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const classification = classifyHost(
      c.req.header("host") ?? new URL(c.req.url).host,
      c.req.header("x-tenant-slug"),
      deps.config,
    );

    if (classification.kind === "app") {
      await next(); // tenant comes from the session, never Host (REQ-020)
      return;
    }
    if (classification.kind === "unknown") return notFound(c);

    const repo = deps.getTenantsRepo();
    const tenant = await repo.findBySlug(classification.slug);
    if (tenant !== null) {
      c.set("publicTenant", { tenantId: tenant.id, slug: tenant.slug });
      await next();
      return;
    }

    // Slug miss: the tenant may have been renamed (REQ-023, EDGE-002).
    const renamed = await repo.findByPreviousSlug(classification.slug);
    if (renamed !== null) {
      if (classification.kind === "slug" && classification.redirectable) {
        return c.redirect(
          slugRedirectUrl(c, classification.slug, renamed.slug),
          301,
        );
      }
      // Custom domain whose configured slug went stale after a rename:
      // still serve the tenant — the domain itself did not change.
      c.set("publicTenant", { tenantId: renamed.id, slug: renamed.slug });
      await next();
      return;
    }

    return notFound(c);
  });
}

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
