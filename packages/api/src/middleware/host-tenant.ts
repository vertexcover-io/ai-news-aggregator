import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { systemContext } from "@newsletter/shared/tenant";

export interface HostTenantOptions {
  appHost?: string;
  rootDomain?: string;
  customDomainTenantMap?: Record<string, string>;
  resolveTenantBySlug?: (slug: string) => Promise<{ tenantId: string } | null>;
}

function stripPort(host: string): string {
  const idx = host.indexOf(":");
  return idx === -1 ? host : host.slice(0, idx);
}

function parseDomainMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function hostTenant(opts: HostTenantOptions = {}): MiddlewareHandler {
  const appHost = opts.appHost ?? process.env.APP_HOST ?? "app.lvh.me";
  const rootDomain = opts.rootDomain ?? process.env.ROOT_DOMAIN ?? "lvh.me";
  const domainMap =
    opts.customDomainTenantMap ?? parseDomainMap(process.env.CUSTOM_DOMAIN_TENANT_MAP);
  const isDev = process.env.NODE_ENV !== "production";

  return createMiddleware(async (c, next) => {
    const setSlug = async (slug: string) => {
      c.set("tenantSlug", slug);
      const resolved = opts.resolveTenantBySlug
        ? await opts.resolveTenantBySlug(slug)
        : null;
      if (resolved) c.set("tenantCtx", systemContext(resolved.tenantId));
    };

    if (isDev) {
      const headerSlug = c.req.header("x-tenant-slug");
      if (headerSlug) {
        await setSlug(headerSlug);
        return next();
      }
    }

    const rawHost = c.req.header("host");
    if (!rawHost) return next();
    const host = stripPort(rawHost);

    if (host === appHost || host === rootDomain) return next();

    const mappedTenantId = domainMap[host];
    if (mappedTenantId) {
      c.set("tenantCtx", systemContext(mappedTenantId));
      return next();
    }

    const suffix = `.${rootDomain}`;
    if (host.endsWith(suffix)) {
      const slug = host.slice(0, host.length - suffix.length).split(".")[0];
      if (slug) await setSlug(slug);
    }

    return next();
  });
}
