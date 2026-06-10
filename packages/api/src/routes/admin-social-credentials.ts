import { Hono } from "hono";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import {
  createSocialTokensRepo,
  type SocialTokensRepo,
} from "@api/repositories/social-tokens.js";

/**
 * Tenant-level social credentials route: shows token connection status
 * (LinkedIn OAuth, Twitter OAuth) for the scoped tenant. App-level secrets
 * (LinkedIn client id/secret, Twitter collector cookie) are managed via the
 * super-admin-only /api/super/app-credentials route.
 */
export interface AdminSocialCredentialsRouterDeps {
  getTokenRepo: () => SocialTokensRepo;
}

export function createAdminSocialCredentialsRouter(
  deps: AdminSocialCredentialsRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const linkedinToken = await deps.getTokenRepo().getLinkedIn();
    return c.json({
      linkedin: {
        connected: linkedinToken !== null,
        expiresAt: linkedinToken?.expiresAt?.toISOString() ?? null,
      },
    });
  });

  return app;
}

export function createDefaultAdminSocialCredentialsRouter(): Hono {
  return createAdminSocialCredentialsRouter({
    getTokenRepo: () =>
      createSocialTokensRepo(defaultGetDb(), BOOTSTRAP_CONTEXT, getCredentialCipher()),
  });
}
