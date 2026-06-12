import { Hono } from "hono";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import { getTenantId } from "@api/middleware/tenant-host.js";
import type {
  SendingDomainRecord,
  SendingDomainsRepo,
} from "@api/repositories/sending-domains.js";
import {
  ResendDomainsError,
  type ResendDomainsClient,
} from "@api/lib/email/resend-domains.js";

export interface SendingDomainRouterDeps {
  getSendingDomainsRepo: (tenantId: string) => SendingDomainsRepo;
  /** null ⇒ no full-access RESEND_API_KEY — register/verify return 503. */
  resendDomains: ResendDomainsClient | null;
  logger?: ReturnType<typeof createLogger>;
}

// RFC-1035-ish: dot-separated labels, no leading/trailing hyphen, alpha TLD.
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const registerSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN_RE, "invalid domain"),
});

// resendDomainId stays server-side; responses carry only tenant-facing state.
function toWire(row: SendingDomainRecord) {
  return {
    domain: row.domain,
    status: row.status,
    dnsRecords: row.dnsRecords ?? [],
    failureReason: row.failureReason,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createSendingDomainRouter(deps: SendingDomainRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sending-domain");
  const app = new Hono();

  app.get("/", async (c) => {
    const row = await deps.getSendingDomainsRepo(getTenantId(c)).get();
    return c.json({ sendingDomain: row === null ? null : toWire(row) });
  });

  app.post("/", async (c) => {
    if (deps.resendDomains === null) {
      return c.json({ error: "sending_domains_unavailable" }, 503);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_domain" }, 400);
    }
    const tenantId = getTenantId(c);
    const { domain } = parsed.data;

    let state;
    try {
      state = await deps.resendDomains.register(domain);
    } catch (err) {
      if (err instanceof ResendDomainsError) {
        logger.error(
          { event: "sending-domain.register_failed", domain, error: err.message },
          "sending-domain: Resend registration failed",
        );
        return c.json({ error: "registration_failed" }, 502);
      }
      throw err;
    }

    const row = await deps.getSendingDomainsRepo(tenantId).upsert({
      domain,
      resendDomainId: state.resendDomainId,
      status: state.status,
      dnsRecords: state.dnsRecords,
      failureReason: state.failureReason,
    });
    logger.info(
      { event: "sending-domain.registered", domain, status: row.status },
      "sending-domain: registered with Resend",
    );
    return c.json({ sendingDomain: toWire(row) }, 201);
  });

  app.post("/verify", async (c) => {
    if (deps.resendDomains === null) {
      return c.json({ error: "sending_domains_unavailable" }, 503);
    }
    const repo = deps.getSendingDomainsRepo(getTenantId(c));
    const existing = await repo.get();
    const resendDomainId = existing?.resendDomainId ?? null;
    if (existing === null || resendDomainId === null) {
      return c.json({ error: "not_registered" }, 404);
    }

    let state;
    try {
      state = await deps.resendDomains.check(resendDomainId);
    } catch (err) {
      if (err instanceof ResendDomainsError) {
        logger.error(
          {
            event: "sending-domain.verify_failed",
            domain: existing.domain,
            error: err.message,
          },
          "sending-domain: Resend verification check failed",
        );
        return c.json({ error: "verification_check_failed" }, 502);
      }
      throw err;
    }

    const row = await repo.updateStatus({
      status: state.status,
      dnsRecords: state.dnsRecords,
      failureReason: state.failureReason,
      lastCheckedAt: new Date(),
    });
    if (row === null) {
      return c.json({ error: "not_registered" }, 404);
    }
    logger.info(
      { event: "sending-domain.verified", domain: row.domain, status: row.status },
      "sending-domain: verification state refreshed",
    );
    return c.json({ sendingDomain: toWire(row) });
  });

  return app;
}
