/**
 * Email-settings routes (Fix #3, Phase B) — mounted auth-gated at
 * /api/settings/email:
 *
 *   GET  /  → current mode + effective sender + masked SMTP config
 *   PUT  /  → set mode; for `smtp`, validate + connection-check + encrypt
 *
 * The SMTP connection check (`verifySmtp`) is injected so tests pass a fake —
 * no real SMTP connection is opened in unit/e2e (S-web-04).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
  createLogger,
  getDb as defaultGetDb,
  getCredentialCipher,
} from "@newsletter/shared";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import type { SmtpConfig } from "@newsletter/shared/types/tenant";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { verifySmtpConnection } from "@api/lib/email/smtp-provider.js";
import {
  EmailSettingsError,
  getEmailSettings,
  updateEmailSettings,
  type EmailSettingsServiceDeps,
} from "@api/services/email-settings.js";

export interface EmailSettingsRouterDeps {
  getTenantsRepo: () => EmailSettingsServiceDeps["tenantsRepo"];
  cipher: EmailSettingsServiceDeps["cipher"];
  verifySmtp: (config: SmtpConfig) => Promise<void>;
  managedEmailDomain: string;
  fromMail: string;
  logger?: ReturnType<typeof createLogger>;
}

const smtpSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024).optional(),
  fromAddress: z.email().max(320),
  fromName: z.string().trim().max(200).optional(),
});

const putSchema = z
  .object({
    mode: z.enum(["managed", "managed_domain", "smtp"]),
    smtp: smtpSchema.optional(),
  })
  .refine((v) => v.mode !== "smtp" || v.smtp !== undefined, {
    message: "smtp config is required when mode is smtp",
  });

export function createEmailSettingsRouter(deps: EmailSettingsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:email-settings");
  const app = new Hono();

  const serviceDeps = (): EmailSettingsServiceDeps => ({
    tenantsRepo: deps.getTenantsRepo(),
    cipher: deps.cipher,
    verifySmtp: deps.verifySmtp,
    managedEmailDomain: deps.managedEmailDomain,
    fromMail: deps.fromMail,
  });

  const tenantIdOr400 = (c: Context): string | null =>
    scopedTenantId(tenantScopeFromContext(c)) ?? null;

  app.get("/email", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    try {
      return c.json(await getEmailSettings(serviceDeps(), tenantId));
    } catch (err) {
      return errorResponse(c, err, logger, tenantId);
    }
  });

  app.put("/email", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid email settings" },
        400,
      );
    }

    try {
      const wire = await updateEmailSettings(serviceDeps(), tenantId, parsed.data);
      logger.info(
        { event: "email_settings.updated", tenantId, mode: wire.mode },
        "email settings updated",
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
  if (err instanceof EmailSettingsError) {
    logger.warn(
      { event: "email_settings.error", tenantId, status: err.status, error: err.message },
      "email settings operation failed",
    );
    return c.json({ error: err.message }, err.status);
  }
  throw err;
}

export function createDefaultEmailSettingsRouter(): Hono {
  return createEmailSettingsRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    cipher: getCredentialCipher(),
    verifySmtp: verifySmtpConnection,
    managedEmailDomain: process.env.MANAGED_EMAIL_DOMAIN ?? "news.vertexcover.io",
    fromMail: process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io",
  });
}
