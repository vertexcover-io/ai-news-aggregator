/**
 * Social credential management.
 *
 * Two tiers (REQ-082):
 *   - App-level secrets — the shared LinkedIn OAuth client and the shared
 *     Twitter collector cookie — are SUPER-ADMIN only and always live in the
 *     app credentials store (tenant 0), regardless of the requesting host.
 *   - Tenant-level: tenants connect LinkedIn/Twitter via OAuth only. Manual
 *     Twitter API-key entry was removed (REQ-081/REQ-086); DELETE /twitter
 *     remains to clear legacy tenant-0 manual rows.
 *
 * Responses never contain secret material — only configured/updatedAt
 * booleans and timestamps (NF6/REQ-125).
 */

import { Hono } from "hono";
import { APP_CREDENTIALS_TENANT_ID } from "@newsletter/shared/constants";
import { getTenantId } from "@api/middleware/tenant-host.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { requireSuperAdmin } from "@api/auth/middleware.js";
import {
  linkedinUpsertSchema,
  twitterCollectorUpsertSchema,
} from "@api/lib/validate-social-credentials.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@api/repositories/social-credentials.js";

export interface AdminSocialCredentialsRouterDeps {
  getRepo: (tenantId: string) => SocialCredentialsRepo;
  /** Verifies the session cookie for the super-admin-only routes. */
  sessionSecret: string;
}

export function createAdminSocialCredentialsRouter(
  deps: AdminSocialCredentialsRouterDeps,
): Hono {
  const app = new Hono();
  const superAdmin = requireSuperAdmin(deps.sessionSecret);
  const appRepo = (): SocialCredentialsRepo =>
    deps.getRepo(APP_CREDENTIALS_TENANT_ID);

  // Status: app-level entries (linkedin client, collector cookie) come from
  // the app store; the legacy manual twitter entry is tenant-scoped.
  app.get("/", async (c) => {
    const [appStatus, tenantStatus] = await Promise.all([
      appRepo().getStatus(),
      deps.getRepo(getTenantId(c)).getStatus(),
    ]);
    return c.json({
      linkedin: appStatus.linkedin,
      twitter: tenantStatus.twitter,
      twitterCollector: appStatus.twitterCollector,
    });
  });

  // Shared LinkedIn OAuth app client — super admin, app store (REQ-082).
  app.put("/linkedin", superAdmin, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = linkedinUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const { updatedAt } = await appRepo().upsertLinkedIn(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/linkedin", superAdmin, async (c) => {
    const removed = await appRepo().delete("linkedin");
    return c.json({ ok: true, removed });
  });

  // Shared Twitter collector cookie — super admin, app store (REQ-086).
  app.put("/twitter-collector", superAdmin, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterCollectorUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const { updatedAt } = await appRepo().upsertTwitterCollector(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/twitter-collector", superAdmin, async (c) => {
    const removed = await appRepo().delete("twitter_collector");
    return c.json({ ok: true, removed });
  });

  // Legacy manual Twitter OAuth1 keys: entry removed (REQ-081 — tenants
  // connect via OAuth only); deletion remains to clear old rows.
  app.delete("/twitter", async (c) => {
    const removed = await deps.getRepo(getTenantId(c)).delete("twitter");
    return c.json({ ok: true, removed });
  });

  app.delete("/:platform", (c) => {
    return c.json({ error: "invalid_platform" }, 400);
  });

  return app;
}

export function createDefaultAdminSocialCredentialsRouter(): Hono {
  return createAdminSocialCredentialsRouter({
    getRepo: (tenantId) =>
      createSocialCredentialsRepo(defaultGetDb(), tenantId, getCredentialCipher()),
    // Validated at startup in index.ts — safe to assert here.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sessionSecret: process.env.SESSION_SECRET!,
  });
}
