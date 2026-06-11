/**
 * Per-tenant notification settings + optional feature flags (P16) — mounted
 * auth-gated at /api/settings:
 *
 *   GET /notifications → { notifyEmail, slackWebhookSet, notifyReviewReady, notifyErrors }
 *   PUT /notifications → persist email + ENCRYPTED Slack webhook (REQ-092)
 *   GET /features      → { featureCanon, featureDeliverability, featureEval }
 *   PUT /features      → independent toggles, all default off (REQ-093)
 *
 * Security invariant (REQ-092): the Slack webhook is write-only. The route
 * encrypts the raw URL with the D-012 credential cipher before it reaches the
 * repo, and responses only ever carry `slackWebhookSet` — neither the
 * plaintext nor the ciphertext is serialized back to the client.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type {
  TenantFeatureFlagsWire,
  TenantNotificationSettingsWire,
} from "@newsletter/shared/types/tenant";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createTenantsRepo,
  type TenantRow,
  type TenantsRepo,
} from "@api/repositories/tenants.js";

export interface NotificationSettingsRouterDeps {
  getTenantsRepo: () => Pick<
    TenantsRepo,
    "findById" | "updateNotificationSettings" | "updateFeatureFlags"
  >;
  cipher: CredentialCipher;
  logger?: ReturnType<typeof createLogger>;
}

const notificationsPutSchema = z.object({
  notifyEmail: z
    .union([z.email(), z.literal("")])
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  /** Absent = keep stored secret; ""/null = clear; URL = encrypt + store. */
  slackWebhook: z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
  notifyReviewReady: z.boolean(),
  notifyErrors: z.boolean(),
});

const featuresPutSchema = z.object({
  featureCanon: z.boolean(),
  featureDeliverability: z.boolean(),
  featureEval: z.boolean(),
});

function toNotificationsWire(tenant: TenantRow): TenantNotificationSettingsWire {
  return {
    notifyEmail: tenant.notifyEmail,
    slackWebhookSet: tenant.slackWebhook !== null,
    notifyReviewReady: tenant.notifyReviewReady,
    notifyErrors: tenant.notifyErrors,
  };
}

function toFeaturesWire(tenant: TenantRow): TenantFeatureFlagsWire {
  return {
    featureCanon: tenant.featureCanon,
    featureDeliverability: tenant.featureDeliverability,
    featureEval: tenant.featureEval,
  };
}

export function createNotificationSettingsRouter(
  deps: NotificationSettingsRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:notification-settings");
  const app = new Hono();

  const tenantIdOr400 = (c: Context): string | null =>
    scopedTenantId(tenantScopeFromContext(c)) ?? null;

  app.get("/notifications", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "tenant not found" }, 404);
    return c.json(toNotificationsWire(tenant));
  });

  app.put("/notifications", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = notificationsPutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues },
        400,
      );
    }

    const { slackWebhook, ...rest } = parsed.data;
    const updated = await deps.getTenantsRepo().updateNotificationSettings(tenantId, {
      ...rest,
      // Encrypt at the boundary (D-012): the repo and DB only ever see ciphertext.
      ...(slackWebhook !== undefined
        ? {
            slackWebhook:
              slackWebhook === null
                ? null
                : JSON.stringify(deps.cipher.encrypt(slackWebhook)),
          }
        : {}),
    });
    if (updated === null) return c.json({ error: "tenant not found" }, 404);
    logger.info(
      {
        event: "notification_settings.saved",
        tenantId,
        emailSet: updated.notifyEmail !== null,
        slackWebhookSet: updated.slackWebhook !== null,
      },
      "notification settings saved",
    );
    return c.json(toNotificationsWire(updated));
  });

  app.get("/features", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "tenant not found" }, 404);
    return c.json(toFeaturesWire(tenant));
  });

  app.put("/features", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = featuresPutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues },
        400,
      );
    }

    // Flags only — feature DATA is never touched here: disabling Canon hides
    // the Must Read page/nav but retains every must_read row (EDGE-014).
    const updated = await deps.getTenantsRepo().updateFeatureFlags(tenantId, parsed.data);
    if (updated === null) return c.json({ error: "tenant not found" }, 404);
    logger.info(
      { event: "feature_flags.saved", tenantId, ...parsed.data },
      "feature flags saved",
    );
    return c.json(toFeaturesWire(updated));
  });

  return app;
}

export function createDefaultNotificationSettingsRouter(): Hono {
  return createNotificationSettingsRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    cipher: getCredentialCipher(),
  });
}
