import { Hono } from "hono";
import { z } from "zod";
import type { Resend } from "resend";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import { registerDomain, checkDomainStatus } from "@api/services/sending-domain.js";
import { createLogger } from "@newsletter/shared";

const registerDomainSchema = z.object({
  name: z
    .string()
    .min(1, "Domain name is required")
    .regex(
      /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      "Invalid domain name",
    ),
});

export interface SendingDomainRouteDeps {
  getTenantsRepo: () => TenantsRepo;
  getResendClient: () => Resend;
  getResendFullAccessKey: () => string | undefined;
  logger?: ReturnType<typeof createLogger>;
}

export function createSendingDomainRouter(deps: SendingDomainRouteDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sending-domain");
  const app = new Hono();

  /**
   * GET /domain — Return the current domain status for the tenant.
   */
  app.get("/", async (c) => {
    const tenantCtx = c.get("tenantCtx") as { tenantId: string } | undefined;
    const tenantId = tenantCtx?.tenantId;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (!tenant?.domainId) {
      return c.json({ status: "none" as const, records: [] });
    }

    return c.json({
      domainId: tenant.domainId,
      domainName: tenant.domainName,
      status: (tenant.domainStatus ?? "none"),
      records: (tenant.domainRecords ?? []),
    });
  });

  /**
   * POST /domain — Register a sending domain with Resend.
   * Stores the returned domainId, DNS records, and status ("pending") on the tenant.
   * REQ-084.
   */
  app.post("/", async (c) => {
    const tenantCtx = c.get("tenantCtx") as { tenantId: string } | undefined;
    const tenantId = tenantCtx?.tenantId;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = registerDomainSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const apiKey = deps.getResendFullAccessKey();
    if (!apiKey) {
      return c.json({ error: "Resend API key not configured" }, 503);
    }

    const resend = deps.getResendClient();
    try {
      const result = await registerDomain(resend, parsed.data.name);

      await deps.getTenantsRepo().updateDomain(tenantId, {
        domainId: result.domainId,
        domainName: parsed.data.name,
        domainStatus: result.status,
        domainRecords: result.records,
      });

      logger.info(
        { event: "sending-domain.registered", tenantId, domain: parsed.data.name, domainId: result.domainId },
        "sending domain registered",
      );

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        { event: "sending-domain.register_failed", tenantId, error: message },
        "sending domain registration failed",
      );
      return c.json({ error: message }, 422);
    }
  });

  /**
   * POST /domain/verify — Check verification status with Resend and update tenant.
   * Maps Resend status to our internal DomainVerificationStatus (none/pending/verified/failed).
   * REQ-085.
   */
  app.post("/verify", async (c) => {
    const tenantCtx = c.get("tenantCtx") as { tenantId: string } | undefined;
    const tenantId = tenantCtx?.tenantId;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (!tenant?.domainId) {
      return c.json({ error: "No domain registered" }, 400);
    }

    const apiKey = deps.getResendFullAccessKey();
    if (!apiKey) {
      return c.json({ error: "Resend API key not configured" }, 503);
    }

    const resend = deps.getResendClient();
    try {
      const result = await checkDomainStatus(resend, tenant.domainId);

      await deps.getTenantsRepo().updateDomain(tenantId, {
        domainStatus: result.status,
        domainRecords: result.records,
      });

      logger.info(
        { event: "sending-domain.verified", tenantId, domainId: tenant.domainId, status: result.status },
        "sending domain verification checked",
      );

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        { event: "sending-domain.verify_failed", tenantId, error: message },
        "sending domain verification failed",
      );
      return c.json({ error: message }, 422);
    }
  });

  return app;
}
