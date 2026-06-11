import { createMiddleware } from "hono/factory";

export interface ResolveTenantConfig {
  rootDomain: string;
  appSubdomain: string;
  customDomainMap: Record<string, string>;
}

export interface HostClassification {
  type: "app" | "slug" | "custom" | "unknown";
  slug?: string;
  tenantId?: string;
}

/** Build tenant resolution config from environment variables. */
export function buildResolveTenantConfig(env: Record<string, string | undefined>): ResolveTenantConfig {
  const rootDomain = env.ROOT_DOMAIN ?? "localhost";
  const appSubdomain = env.APP_SUBDOMAIN ?? "app";
  const customDomainMap: Record<string, string> = {};

  const customMapRaw = env.CUSTOM_DOMAIN_MAP;
  if (customMapRaw) {
    for (const entry of customMapRaw.split(",")) {
      const eq = entry.indexOf("=");
      if (eq > 0) {
        const domain = entry.slice(0, eq).trim();
        const tenantId = entry.slice(eq + 1).trim();
        if (domain && tenantId) {
          customDomainMap[domain] = tenantId;
        }
      }
    }
  }

  return { rootDomain, appSubdomain, customDomainMap };
}

/**
 * Classify a Host header into app/slug/custom/unknown.
 * Does NOT look up the DB — that happens later in the middleware.
 */
export function classifyHost(
  host: string,
  cfg: ResolveTenantConfig,
): HostClassification {
  // Check custom domain first
  const customTenant = cfg.customDomainMap[host];
  if (customTenant) {
    return { type: "custom", tenantId: customTenant };
  }

  // Strip port if present
  const hostname = host.split(":")[0];

  // Check if it's the app subdomain
  if (hostname === `${cfg.appSubdomain}.${cfg.rootDomain}`) {
    return { type: "app" };
  }

  // Check if it ends with rootDomain (slug pattern)
  const suffix = `.${cfg.rootDomain}`;
  if (hostname.endsWith(suffix)) {
    const prefix = hostname.slice(0, -suffix.length);
    if (prefix.length > 0 && prefix !== cfg.appSubdomain) {
      return { type: "slug", slug: prefix };
    }
  }

  return { type: "unknown" };
}

/** Validate a slug: lowercase alphanumeric, may contain hyphens but not at start/end. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug);
}

/** Hono middleware: resolves the active tenant from the Host header and sets c.var.tenantCtx. */
export function resolveTenant(config: ResolveTenantConfig) {
  return createMiddleware(async (c, next) => {
    const host = c.req.header("host") ?? "";

    // Dev override: X-Tenant-Slug header (NODE_ENV !== 'production' only)
    const devSlug =
      typeof process !== "undefined" &&
      process.env.NODE_ENV !== "production"
        ? c.req.header("x-tenant-slug")
        : undefined;

    const classification = classifyHost(host, config);

    if (classification.type === "unknown") {
      // For app-host requests without a valid host header, don't 404 —
      // fall through and let session auth handle it (admin routes).
      // For public routes, this means no tenant context is set.
    }

    // Store classification for downstream middleware/routes
    c.set("hostClassification", classification);

    if (devSlug && isValidSlug(devSlug)) {
      c.set("hostClassification", { type: "slug", slug: devSlug });
    }

    await next();
  });
}
