import { Hono } from "hono";
import { z } from "zod";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { CredentialCipher } from "@newsletter/shared/services";

const SLACK_WEBHOOK_HOST = "hooks.slack.com";

function isSlackWebhookUrl(v: string | null): boolean {
  if (v === null) return true;
  try {
    const u = new URL(v);
    return u.hostname === SLACK_WEBHOOK_HOST && u.protocol === "https:";
  } catch {
    return false;
  }
}

const putSchema = z.object({
  notifyEmail: z.email().nullable().optional(),
  slackWebhook: z
    .url()
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || isSlackWebhookUrl(v), {
      message: "slackWebhook must be a hooks.slack.com URL or null",
    }),
}).partial();

export interface NotificationsRouterDeps {
  getTenantsRepo: () => TenantsRepo;
  getCipher?: () => CredentialCipher;
}

export function createNotificationsRouter(deps: NotificationsRouterDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const ctx = c.get("tenantCtx");
    const tenant = await deps.getTenantsRepo().findById(ctx.tenantId);
    if (!tenant) {
      return c.json({ error: "tenant not found" }, 404);
    }
    return c.json({
      notifyEmail: tenant.notifyEmail ?? null,
      slackWebhook: tenant.slackWebhook ?? null,
    });
  });

  app.put("/", async (c) => {
    const ctx = c.get("tenantCtx");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }

    const { notifyEmail, slackWebhook } = parsed.data;

    // Encrypt the webhook if provided and a cipher is available
    const getCipher = deps.getCipher;
    let encryptedWebhook = null;
    if (slackWebhook) {
      if (!getCipher) {
        return c.json({ error: "cipher unavailable" }, 500);
      }
      encryptedWebhook = getCipher().encrypt(slackWebhook);
    }

    const tenant = await deps.getTenantsRepo().updateNotifications(ctx.tenantId, {
      notifyEmail,
      slackWebhook: encryptedWebhook ?? null,
    });

    return c.json({
      notifyEmail: tenant.notifyEmail ?? null,
      slackWebhook: tenant.slackWebhook ?? null,
    });
  });

  return app;
}
