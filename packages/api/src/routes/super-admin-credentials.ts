import { Hono } from "hono";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { agentloopContext } from "@newsletter/shared/tenant";
import type { TenantContext } from "@newsletter/shared";
import {
  linkedinUpsertSchema,
  twitterCollectorUpsertSchema,
} from "@api/lib/validate-social-credentials.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialPlatform,
  type SocialCredentialsRepo,
} from "@api/repositories/social-credentials.js";
import type { TenantVariables } from "@api/middleware/types.js";

/**
 * App-level secret store for super admins only (F62/NF6). These credentials —
 * the LinkedIn OAuth client and the shared Twitter collector cookie — are
 * platform-wide infrastructure, never tenant-facing. Tenant admins must never
 * see or manage them. We persist them via the social-credentials repo scoped to
 * the AGENTLOOP (tenant 0) row, which serves as the canonical app-level home.
 */
export interface SuperAdminCredentialsRouterDeps {
  getRepo: () => SocialCredentialsRepo;
}

const APP_LEVEL_PLATFORM_SLUG_TO_KEY: Partial<
  Record<string, SocialCredentialPlatform>
> = {
  linkedin: "linkedin",
  "twitter-collector": "twitter_collector",
};

function isSuperAdmin(ctx: TenantContext | undefined): boolean {
  return ctx?.role === "super_admin";
}

export function createSuperAdminCredentialsRouter(
  deps: SuperAdminCredentialsRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const app = new Hono<{ Variables: TenantVariables }>();

  // Gate the entire router to super_admin; tenant admins get 403.
  app.use("*", async (c, next) => {
    if (!isSuperAdmin(c.get("tenantCtx"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  app.get("/", async (c) => {
    const status = await deps.getRepo().getStatus();
    // Only expose the app-level platforms; never the tenant-facing twitter
    // poster creds.
    return c.json({
      linkedin: status.linkedin,
      twitterCollector: status.twitterCollector,
    });
  });

  app.put("/linkedin", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = linkedinUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertLinkedIn(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter-collector", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterCollectorUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps
      .getRepo()
      .upsertTwitterCollector(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:platform", async (c) => {
    const slug = c.req.param("platform");
    const key = APP_LEVEL_PLATFORM_SLUG_TO_KEY[slug];
    if (key === undefined) {
      return c.json({ error: "invalid_platform" }, 400);
    }
    const removed = await deps.getRepo().delete(key);
    return c.json({ ok: true, removed });
  });

  return app;
}

export function createDefaultSuperAdminCredentialsRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createSuperAdminCredentialsRouter({
    getRepo: () =>
      createSocialCredentialsRepo(
        defaultGetDb(),
        getCredentialCipher(),
        agentloopContext(),
      ),
  });
}
