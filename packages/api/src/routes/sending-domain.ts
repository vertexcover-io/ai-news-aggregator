/**
 * Sending-domain routes (P14, REQ-084/085) — mounted auth-gated at
 * /api/settings/domain:
 *
 *   GET  /        → stored panel state (no Resend call)
 *   POST /        → register domain with Resend, return DNS records
 *   POST /verify  → trigger Resend verification, return refreshed status
 *
 * Resend is injected (`domainsClient`) so tests pass a fake; production wires
 * `createDefaultResendDomainsClient()` (full-access key — see service header).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import {
  createDefaultResendDomainsClient,
  registerSendingDomain,
  sendingDomainFromTenant,
  SendingDomainError,
  verifySendingDomain,
  type ResendDomainsClient,
  type SendingDomainTenantsRepo,
} from "@api/services/sending-domain.js";

export interface SendingDomainRouterDeps {
  getTenantsRepo: () => SendingDomainTenantsRepo;
  domainsClient: ResendDomainsClient;
  logger?: ReturnType<typeof createLogger>;
}

// Hostname only — no scheme, no path, at least one dot, RFC-1035 labels.
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const addDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN_RE, "must be a bare domain name like news.example.com"),
});

export function createSendingDomainRouter(deps: SendingDomainRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sending-domain");
  const app = new Hono();

  const tenantIdOr400 = (c: Context): string | null =>
    scopedTenantId(tenantScopeFromContext(c)) ?? null;

  app.get("/", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "tenant not found" }, 404);
    return c.json({ domain: sendingDomainFromTenant(tenant) });
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
    const parsed = addDomainSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid domain" }, 400);
    }

    try {
      const domain = await registerSendingDomain(
        { tenantsRepo: deps.getTenantsRepo(), domainsClient: deps.domainsClient },
        tenantId,
        parsed.data.domain,
      );
      logger.info(
        { event: "sending_domain.registered", tenantId, domain: domain.domain },
        "sending domain registered with Resend",
      );
      return c.json({ domain });
    } catch (err) {
      return sendingDomainErrorResponse(c, err, logger, tenantId);
    }
  });

  app.post("/verify", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);

    try {
      const domain = await verifySendingDomain(
        { tenantsRepo: deps.getTenantsRepo(), domainsClient: deps.domainsClient },
        tenantId,
      );
      logger.info(
        {
          event: "sending_domain.verify_checked",
          tenantId,
          domain: domain.domain,
          status: domain.status,
        },
        "sending domain verification checked",
      );
      return c.json({ domain });
    } catch (err) {
      return sendingDomainErrorResponse(c, err, logger, tenantId);
    }
  });

  return app;
}

function sendingDomainErrorResponse(
  c: Context,
  err: unknown,
  logger: ReturnType<typeof createLogger>,
  tenantId: string,
): Response {
  if (err instanceof SendingDomainError) {
    logger.warn(
      { event: "sending_domain.error", tenantId, status: err.status, error: err.message },
      "sending domain operation failed",
    );
    return c.json({ error: err.message }, err.status);
  }
  throw err;
}

export function createDefaultSendingDomainRouter(): Hono {
  return createSendingDomainRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    domainsClient: createDefaultResendDomainsClient(),
  });
}
