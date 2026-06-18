/**
 * Custom web-domain routes (Fix #3, Phase C) — mounted auth-gated at
 * /api/admin/web-domain:
 *
 *   GET  /        → stored panel state (domain + status + DNS record)
 *   POST /        → register a domain, return the DNS record to add
 *   POST /verify  → re-check DNS, flip status to verified|failed
 *
 * DNS lookup is injected (`resolveDns`) so tests run without real DNS.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import {
  registerWebDomain,
  verifyWebDomain,
  webDomainFromTenant,
  WebDomainError,
  resolveDnsDefault,
  type WebDomainServiceDeps,
} from "@api/services/web-domain.js";

export interface WebDomainRouterDeps {
  getTenantsRepo: () => WebDomainServiceDeps["tenantsRepo"];
  resolveDns: WebDomainServiceDeps["resolveDns"];
  ingressHost: string;
  ingressIp: string;
  reservedSuffixes: string[];
  logger?: ReturnType<typeof createLogger>;
}

const registerSchema = z.object({ domain: z.string().min(1).max(253) });

export function createWebDomainRouter(deps: WebDomainRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:web-domain");
  const app = new Hono();

  const serviceDeps = (): WebDomainServiceDeps => ({
    tenantsRepo: deps.getTenantsRepo(),
    resolveDns: deps.resolveDns,
    ingressHost: deps.ingressHost,
    ingressIp: deps.ingressIp,
    reservedSuffixes: deps.reservedSuffixes,
  });

  const tenantIdOr400 = (c: Context): string | null =>
    scopedTenantId(tenantScopeFromContext(c)) ?? null;

  app.get("/", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "tenant not found" }, 404);
    return c.json(webDomainFromTenant(tenant, deps.ingressHost, deps.ingressIp));
  });

  app.post("/", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid domain" }, 400);
    try {
      const wire = await registerWebDomain(serviceDeps(), tenantId, parsed.data.domain);
      logger.info({ event: "web_domain.registered", tenantId, domain: wire.domain }, "web domain registered");
      return c.json(wire);
    } catch (err) {
      return errorResponse(c, err, logger, tenantId);
    }
  });

  app.post("/verify", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    try {
      const wire = await verifyWebDomain(serviceDeps(), tenantId);
      logger.info(
        { event: "web_domain.verify_checked", tenantId, domain: wire.domain, status: wire.status },
        "web domain verification checked",
      );
      return c.json(wire);
    } catch (err) {
      return errorResponse(c, err, logger, tenantId);
    }
  });

  return app;
}

function errorResponse(
  c: Context,
  err: unknown,
  logger: ReturnType<typeof createLogger>,
  tenantId: string,
): Response {
  if (err instanceof WebDomainError) {
    logger.warn(
      { event: "web_domain.error", tenantId, status: err.status, error: err.message },
      "web domain operation failed",
    );
    return c.json({ error: err.message }, err.status);
  }
  throw err;
}

export function createDefaultWebDomainRouter(): Hono {
  const rootDomain = process.env.ROOT_DOMAIN ?? "";
  const appHost = process.env.APP_HOST ?? (rootDomain ? `app.${rootDomain}` : "");
  return createWebDomainRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    resolveDns: resolveDnsDefault,
    ingressHost: process.env.CUSTOM_DOMAIN_TARGET ?? `ingress.${rootDomain}`,
    ingressIp: process.env.CUSTOM_DOMAIN_IP ?? "",
    reservedSuffixes: [rootDomain, appHost].filter((s) => s.length > 0),
  });
}
