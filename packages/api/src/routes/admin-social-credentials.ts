import { Hono } from "hono";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  linkedinUpsertSchema,
  twitterCollectorUpsertSchema,
  twitterUpsertSchema,
} from "@api/lib/validate-social-credentials.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialPlatform,
  type SocialCredentialsRepo,
} from "@api/repositories/social-credentials.js";
import {
  createSocialTokensRepo,
  type SocialTokensRepo,
} from "@api/repositories/social-tokens.js";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface AdminSocialCredentialsRouterDeps {
  getRepo: (ctx: TenantContext) => SocialCredentialsRepo;
  /**
   * Token repo, used to also clear the OAuth access/refresh token when LinkedIn
   * credentials are cleared. Optional so existing callers/tests that only set
   * getRepo keep working (the token clear is then skipped).
   */
  getTokenRepo?: (ctx: TenantContext) => SocialTokensRepo;
}

// Public URL slug → internal storage key. The slug stays kebab-case in the URL
// for HTTP convention; the storage layer uses snake_case for the Postgres enum
// value.
const PLATFORM_SLUG_TO_KEY: Partial<Record<string, SocialCredentialPlatform>> = {
  linkedin: "linkedin",
  twitter: "twitter",
  "twitter-collector": "twitter_collector",
};

export function createAdminSocialCredentialsRouter(
  deps: AdminSocialCredentialsRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = await deps.getRepo(resolveTenantCtx(c)).getStatus();
    return c.json(status);
  });

  app.put("/linkedin", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = linkedinUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const { updatedAt } = await deps.getRepo(resolveTenantCtx(c)).upsertLinkedIn(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
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
    const { updatedAt } = await deps.getRepo(resolveTenantCtx(c)).upsertTwitter(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter-collector", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterCollectorUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const { updatedAt } = await deps
      .getRepo(resolveTenantCtx(c))
      .upsertTwitterCollector(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:platform", async (c) => {
    const slug = c.req.param("platform");
    const key = PLATFORM_SLUG_TO_KEY[slug];
    if (key === undefined) {
      return c.json({ error: "invalid_platform" }, 400);
    }
    const removed = await deps.getRepo(resolveTenantCtx(c)).delete(key);
    // Clearing LinkedIn credentials must also clear the OAuth access/refresh
    // token — otherwise the connection still shows "Connected" with an orphaned
    // social_tokens row after the client creds are gone.
    if (key === "linkedin" && deps.getTokenRepo) {
      await deps.getTokenRepo(resolveTenantCtx(c)).deleteToken("linkedin");
    }
    return c.json({ ok: true, removed });
  });

  return app;
}

export function createDefaultAdminSocialCredentialsRouter(): Hono {
  return createAdminSocialCredentialsRouter({
    getRepo: (ctx) =>
      createSocialCredentialsRepo(defaultGetDb(), ctx, getCredentialCipher()),
    getTokenRepo: (ctx) =>
      createSocialTokensRepo(defaultGetDb(), ctx, getCredentialCipher()),
  });
}
