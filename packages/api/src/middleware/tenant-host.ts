import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { AuthContext, PublicTenantContext } from "@newsletter/shared/types";
import type { TenantsRepo } from "@api/repositories/tenants.js";

export type HostResolution =
  | { kind: "app" }
  | { kind: "slug"; slug: string }
  | { kind: "tenant0" }
  | { kind: "unknown" };

export interface ResolveHostOptions {
  appHost: string;
  rootDomain: string;
  tenant0Domain?: string | undefined;
}

export interface PublicTenantEnv {
  Variables: {
    auth?: AuthContext;
    publicTenant?: PublicTenantContext;
  };
}

function stripPort(hostHeader: string): string {
  const idx = hostHeader.lastIndexOf(":");
  if (idx === -1) return hostHeader;
  return hostHeader.slice(0, idx);
}

export function resolveHost(
  hostHeader: string | undefined,
  opts: ResolveHostOptions,
): HostResolution {
  if (!hostHeader) return { kind: "unknown" };
  const host = stripPort(hostHeader).toLowerCase();
  if (host === "") return { kind: "unknown" };
  if (host === opts.appHost.toLowerCase()) return { kind: "app" };
  if (host === opts.tenant0Domain?.toLowerCase()) {
    return { kind: "tenant0" };
  }
  const suffix = `.${opts.rootDomain.toLowerCase()}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    if (slug.length > 0 && !slug.includes(".")) {
      return { kind: "slug", slug };
    }
  }
  return { kind: "unknown" };
}

export interface PublicTenantMiddlewareOptions extends ResolveHostOptions {
  getTenantsRepo: () => Pick<TenantsRepo, "findBySlug" | "findByPreviousSlug">;
  /** Dev-only: lets X-Tenant-Slug override the Host header (never in production). */
  allowDevHeader: boolean;
}

function notFound(c: Context): Response {
  // EDGE-013/REQ-031: never leak whether a tenant exists.
  return c.json({ error: "not_found" }, 404);
}

function redirectToSlug(
  c: Context,
  newSlug: string,
  rootDomain: string,
): Response {
  const url = new URL(c.req.url);
  const hostHeader = c.req.header("host") ?? url.host;
  const portIdx = hostHeader.lastIndexOf(":");
  const port = portIdx === -1 ? "" : hostHeader.slice(portIdx);
  const location = `${url.protocol}//${newSlug}.${rootDomain}${port}${url.pathname}${url.search}`;
  return c.redirect(location, 301);
}

export function createPublicTenantMiddleware(
  opts: PublicTenantMiddlewareOptions,
): MiddlewareHandler<PublicTenantEnv> {
  return createMiddleware<PublicTenantEnv>(async (c, next) => {
    const devSlug = opts.allowDevHeader
      ? c.req.header("x-tenant-slug")
      : undefined;
    const resolution: HostResolution = devSlug
      ? { kind: "slug", slug: devSlug.toLowerCase() }
      : resolveHost(c.req.header("host"), opts);

    if (resolution.kind === "tenant0") {
      c.set("publicTenant", { tenantId: TENANT_ZERO_ID, slug: null });
      return next();
    }

    if (resolution.kind !== "slug") {
      // App host carries no public tenant surface (REQ-020); unknown hosts 404.
      return notFound(c);
    }

    const repo = opts.getTenantsRepo();
    const tenant = await repo.findBySlug(resolution.slug);
    if (tenant !== null && tenant.status === "active") {
      c.set("publicTenant", { tenantId: tenant.id, slug: tenant.slug });
      return next();
    }

    // REQ-023: renamed slugs 301-redirect to the new host, preserving path+query.
    const renamed = await repo.findByPreviousSlug(resolution.slug);
    if (renamed !== null && renamed.status === "active") {
      return redirectToSlug(c, renamed.slug, opts.rootDomain);
    }

    return notFound(c);
  });
}

interface TenantContextSource {
  get(key: "auth"): AuthContext | undefined;
  get(key: "publicTenant"): PublicTenantContext | undefined;
}

/** Effective tenant for the request: session tenant on admin routes, host
 * tenant on public routes. Throwing means a route forgot its middleware —
 * a programmer error, not a client error. */
export function getTenantId(c: TenantContextSource): string {
  const auth = c.get("auth");
  if (auth?.tenantId) return auth.tenantId;
  const publicTenant = c.get("publicTenant");
  if (publicTenant) return publicTenant.tenantId;
  throw new Error("getTenantId: no tenant context on request");
}
