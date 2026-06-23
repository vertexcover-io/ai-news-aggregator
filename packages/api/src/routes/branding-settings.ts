/**
 * Admin branding settings (FIX #1) — mounted auth-gated at /api/settings:
 *
 *   GET  /branding       → { name, headline, topicStrip, subtagline, hasLogo, logoUrl }
 *   PUT  /branding       → persist the onboarding-captured brand text fields
 *   GET  /branding/logo  → the SESSION tenant's logo bytes (admin preview)
 *   POST /branding/logo  → validate (reuse validateLogo) + store new logo bytes
 *
 * These are the same brand fields onboarding wrote to the tenants row; the gap
 * this closes is that Admin Settings could neither view nor edit them after
 * activation. Logo bytes are never serialized into the JSON payload — they only
 * leave through the dedicated logo response (mirrors the public branding route).
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { BrandingSettings } from "@newsletter/shared/types/tenant";
import { scopedTenantId } from "@newsletter/shared/types/tenant-context";
import { validateLogo } from "@api/lib/logo-validation.js";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createTenantsRepo,
  type TenantRow,
  type TenantsRepo,
} from "@api/repositories/tenants.js";

export interface BrandingSettingsRouterDeps {
  getTenantsRepo: () => Pick<
    TenantsRepo,
    "findById" | "updateBranding" | "updateLogo"
  >;
  logger?: ReturnType<typeof createLogger>;
}

const brandingPutSchema = z.object({
  name: z.string().trim().min(1, "newsletter name is required").max(120),
  headline: z.string().trim().max(280).nullable(),
  topicStrip: z.string().trim().max(280).nullable(),
  subtagline: z.string().trim().max(280).nullable(),
});

function logoHash(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

export function toBrandingSettingsWire(tenant: TenantRow): BrandingSettings {
  const hasLogo = tenant.logoBytes !== null && tenant.logoContentType !== null;
  return {
    name: tenant.name,
    headline: tenant.headline,
    topicStrip: tenant.topicStrip,
    subtagline: tenant.subtagline,
    logoUrl:
      hasLogo && tenant.logoBytes !== null
        ? `/api/settings/branding/logo?v=${logoHash(tenant.logoBytes).slice(0, 16)}`
        : null,
    hasLogo,
  };
}

export function createBrandingSettingsRouter(
  deps: BrandingSettingsRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:branding-settings");
  const app = new Hono();

  const tenantIdOr400 = (c: Context): string | null =>
    scopedTenantId(tenantScopeFromContext(c)) ?? null;

  app.get("/branding", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "tenant not found" }, 404);
    return c.json(toBrandingSettingsWire(tenant));
  });

  app.put("/branding", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = brandingPutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues },
        400,
      );
    }

    const updated = await deps.getTenantsRepo().updateBranding(tenantId, parsed.data);
    if (updated === null) return c.json({ error: "tenant not found" }, 404);
    logger.info({ event: "branding_settings.saved", tenantId }, "branding settings saved");
    return c.json(toBrandingSettingsWire(updated));
  });

  // Session-scoped preview (no-store), unlike the public Host-resolved
  // /api/branding/logo — the admin previews their OWN tenant's logo.
  app.get("/branding/logo", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant?.logoBytes == null || tenant.logoContentType === null) {
      return c.json({ error: "not_found" }, 404);
    }
    c.header("Content-Type", tenant.logoContentType);
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(tenant.logoBytes));
  });

  app.post("/branding/logo", async (c) => {
    const tenantId = tenantIdOr400(c);
    if (tenantId === null) return c.json({ error: "no tenant in session" }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const verdict = validateLogo(bytes);
    if (!verdict.ok) {
      // Rejected uploads never reach the repo → prior logo intact (REQ-039).
      return c.json({ error: verdict.reason }, 400);
    }
    const updated = await deps
      .getTenantsRepo()
      .updateLogo(tenantId, Buffer.from(bytes), verdict.contentType);
    if (updated === null) return c.json({ error: "tenant not found" }, 404);
    logger.info({ event: "branding_settings.logo_saved", tenantId }, "branding logo saved");
    return c.json({ ok: true, contentType: verdict.contentType });
  });

  return app;
}

export function createDefaultBrandingSettingsRouter(): Hono {
  return createBrandingSettingsRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
  });
}
