/**
 * Tenant-facing social credentials routes (P12, REQ-080/082/086):
 *
 *   GET    /          — status (tenant twitter + app-level configured flags)
 *   PUT    /twitter   — the tenant's OWN Twitter OAuth1 posting keys
 *   DELETE /linkedin  — disconnect: deletes the tenant's LinkedIn OAuth token
 *   DELETE /twitter   — clears the tenant's Twitter posting keys
 *
 * App-level secrets (LinkedIn client id/secret, Twitter collector cookie) are
 * NOT settable here anymore — those live under requireSuperAdmin at
 * /api/super/app-credentials (routes/super-app-credentials.ts). Tenant
 * responses only ever carry configured/updatedAt projections, never secret
 * material (NF6).
 */
import { Hono } from "hono";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { twitterUpsertSchema } from "@api/lib/validate-social-credentials.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@api/repositories/social-credentials.js";
import {
  createSocialTokensRepo,
  type SocialTokensRepo,
} from "@api/repositories/social-tokens.js";
import {
  createAppCredentialsRepo,
  type AppCredentialsRepo,
} from "@api/repositories/app-credentials.js";

export interface AdminSocialCredentialsRouterDeps {
  getRepo: (scope?: TenantScope) => SocialCredentialsRepo;
  /**
   * Token repo for the tenant's own OAuth connections — DELETE /linkedin is a
   * token disconnect (the client credential is app-level now). Optional so
   * existing callers/tests that only set getRepo keep working (the linkedin
   * disconnect then reports removed:false).
   */
  getTokenRepo?: (scope?: TenantScope) => SocialTokensRepo;
  /**
   * App-level store, used ONLY for configured/updatedAt flags in GET / so the
   * settings UI can tell whether the shared LinkedIn client / collector
   * cookie exist. Never returns secret material. Optional for legacy test
   * composition — absent means "not configured".
   */
  getAppRepo?: () => Pick<AppCredentialsRepo, "getStatus">;
}

export function createAdminSocialCredentialsRouter(
  deps: AdminSocialCredentialsRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantStatus = await deps.getRepo(tenantScopeFromContext(c)).getStatus();
    const appStatus = deps.getAppRepo
      ? await deps.getAppRepo().getStatus()
      : null;
    // Tenant-facing projection (REQ-082/NF6): app-level entries surface only
    // configured/updatedAt — the secrets themselves are super-admin-only.
    return c.json({
      linkedin: {
        configured: appStatus?.linkedinClient.configured ?? false,
        apiVersion: appStatus?.linkedinClient.apiVersion ?? null,
        updatedAt: appStatus?.linkedinClient.updatedAt ?? null,
      },
      twitter: tenantStatus.twitter,
      twitterCollector: {
        configured: appStatus?.twitterCollector.configured ?? false,
        updatedAt: appStatus?.twitterCollector.updatedAt ?? null,
      },
    });
  });

  app.put("/twitter", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const { updatedAt } = await deps.getRepo(tenantScopeFromContext(c)).upsertTwitter(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:platform", async (c) => {
    const slug = c.req.param("platform");
    const scope = tenantScopeFromContext(c);
    // Disconnect LinkedIn: tenants own only their OAuth token (REQ-080); the
    // shared client credential is super-admin-managed and untouched here.
    if (slug === "linkedin") {
      const removed = deps.getTokenRepo
        ? await deps.getTokenRepo(scope).deleteToken("linkedin")
        : false;
      return c.json({ ok: true, removed });
    }
    if (slug === "twitter") {
      const removed = await deps.getRepo(scope).delete("twitter");
      return c.json({ ok: true, removed });
    }
    return c.json({ error: "invalid_platform" }, 400);
  });

  return app;
}

export function createDefaultAdminSocialCredentialsRouter(): Hono {
  return createAdminSocialCredentialsRouter({
    getRepo: (scope) =>
      createSocialCredentialsRepo(defaultGetDb(), getCredentialCipher(), scope),
    getTokenRepo: (scope) =>
      createSocialTokensRepo(defaultGetDb(), getCredentialCipher(), scope),
    getAppRepo: () =>
      createAppCredentialsRepo(defaultGetDb(), getCredentialCipher()),
  });
}
