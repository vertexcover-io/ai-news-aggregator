import { Hono } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import {
  getCredentialCipher,
  type CredentialCipher,
} from "@newsletter/shared/services/credential-cipher";
import type { TenantRow } from "@newsletter/shared";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared/tenant";
import {
  createTenantsRepo,
  type TenantBrandingUpdate,
} from "@api/repositories/tenants.js";
import type { TenantVariables } from "@api/middleware/types.js";

const nullableTrimmed = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().min(1).nullable(),
);

const tenantSettingsPatchSchema = z
  .object({
    name: nullableTrimmed.optional(),
    headline: nullableTrimmed.optional(),
    topicStrip: nullableTrimmed.optional(),
    subtagline: nullableTrimmed.optional(),
    canonEnabled: z.boolean().optional(),
    deliverabilityEnabled: z.boolean().optional(),
    evalEnabled: z.boolean().optional(),
    notificationEmail: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.email().nullable(),
    ).optional(),
    // null clears the webhook; string sets it (stored encrypted at rest).
    slackWebhook: z.union([z.url(), z.null()]).optional(),
  })
  .strict();

export type TenantSettingsPatchBody = z.infer<typeof tenantSettingsPatchSchema>;

export interface TenantSettingsUpdate {
  name?: string | null;
  headline?: string | null;
  topicStrip?: string | null;
  subtagline?: string | null;
  canonEnabled?: boolean;
  deliverabilityEnabled?: boolean;
  evalEnabled?: boolean;
  notificationEmail?: string | null;
  slackWebhook?: EncryptedBlob | null;
}

export interface TenantSettingsRepo {
  getById(id: string): Promise<TenantRow | null>;
  updateSettings(id: string, update: TenantSettingsUpdate): Promise<TenantRow>;
}

export interface TenantSettingsRouterDeps {
  getTenantsRepo: () => TenantSettingsRepo;
  cipher?: CredentialCipher;
  logger?: ReturnType<typeof createLogger>;
}

// F74: shortlist size is internal-only and must NOT be exposed to tenants.
function serializeTenantSettings(row: TenantRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    name: row.name,
    headline: row.headline,
    topicStrip: row.topicStrip,
    subtagline: row.subtagline,
    canonEnabled: row.canonEnabled,
    deliverabilityEnabled: row.deliverabilityEnabled,
    evalEnabled: row.evalEnabled,
    notificationEmail: row.notificationEmail,
    slackWebhookConfigured: row.slackWebhook !== null,
  };
}

export function createTenantSettingsRouter(
  deps: TenantSettingsRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const logger = deps.logger ?? createLogger("api:tenant-settings");
  const cipher = deps.cipher ?? getCredentialCipher();
  const app = new Hono<{ Variables: TenantVariables }>();

  app.get("/", async (c) => {
    const tenantId = c.get("tenantCtx")?.tenantId ?? AGENTLOOP_TENANT_ID;
    const row = await deps.getTenantsRepo().getById(tenantId);
    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(serializeTenantSettings(row));
  });

  app.patch("/", async (c) => {
    const tenantId = c.get("tenantCtx")?.tenantId ?? AGENTLOOP_TENANT_ID;
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }

    const update: TenantSettingsUpdate = {};
    const d = parsed.data;
    if (d.name !== undefined) update.name = d.name;
    if (d.headline !== undefined) update.headline = d.headline;
    if (d.topicStrip !== undefined) update.topicStrip = d.topicStrip;
    if (d.subtagline !== undefined) update.subtagline = d.subtagline;
    if (d.canonEnabled !== undefined) update.canonEnabled = d.canonEnabled;
    if (d.deliverabilityEnabled !== undefined)
      update.deliverabilityEnabled = d.deliverabilityEnabled;
    if (d.evalEnabled !== undefined) update.evalEnabled = d.evalEnabled;
    if (d.notificationEmail !== undefined)
      update.notificationEmail = d.notificationEmail;
    if (d.slackWebhook !== undefined) {
      update.slackWebhook =
        d.slackWebhook === null ? null : cipher.encrypt(d.slackWebhook);
    }

    const row = await deps.getTenantsRepo().updateSettings(tenantId, update);
    logger.info({ event: "tenant_settings.saved", tenantId }, "tenant_settings.saved");
    return c.json(serializeTenantSettings(row));
  });

  return app;
}

// Adapter: the tenants repo's updateBranding spreads its update straight into
// `.set(...)`, so notificationEmail/slackWebhook persist at runtime. The repo's
// TenantBrandingUpdate type does not yet name those two columns — extending it
// (or adding a dedicated updateSettings) is DEFERRED TO BARRIER. The cast is
// confined to this single seam so the route stays fully typed.
function toTenantSettingsRepo(
  repo: ReturnType<typeof createTenantsRepo>,
): TenantSettingsRepo {
  return {
    getById: (id) => repo.getById(id),
    updateSettings: (id, update) =>
      repo.updateBranding(id, update as TenantBrandingUpdate),
  };
}

export function createDefaultTenantSettingsRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createTenantSettingsRouter({
    getTenantsRepo: () => toTenantSettingsRepo(createTenantsRepo(defaultGetDb())),
  });
}
