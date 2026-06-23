/**
 * Super-admin app-level credentials (P12, REQ-082/086, NF6):
 *
 *   GET    /                   — status projection (booleans/timestamps only)
 *   PUT    /linkedin-client    — set the shared LinkedIn OAuth client
 *   PUT    /twitter-collector  — set the shared Twitter collector cookie
 *   PUT    /twitter-client     — set the shared Twitter OAuth2 app client (P13)
 *   PUT    /apify              — set the Apify API token (REQ-015)
 *   DELETE /:key               — clear an app credential
 *
 * Mounted at /api/super/app-credentials. ALL routes sit behind
 * requireSuperAdmin (applied inside this factory so no mounting mistake can
 * expose them) — tenants can never read or write app-level secrets, and no
 * response ever serializes the secret material itself.
 */
import { Hono } from "hono";
import { requireSuperAdmin } from "@api/auth/middleware.js";
import {
  linkedinUpsertSchema,
  twitterClientUpsertSchema,
  twitterCollectorUpsertSchema,
  apifyUpsertSchema,
} from "@api/lib/validate-social-credentials.js";
import type {
  AppCredentialKey,
  AppCredentialsRepo,
} from "@api/repositories/app-credentials.js";

export interface SuperAppCredentialsRouterDeps {
  sessionSecret: string;
  getRepo: () => AppCredentialsRepo;
}

// Public URL slug → internal storage key (kebab-case in URLs, snake_case in
// the table — same convention as the tenant social-credentials routes).
const KEY_SLUG_TO_KEY: Partial<Record<string, AppCredentialKey>> = {
  "linkedin-client": "linkedin_client",
  "twitter-collector": "twitter_collector",
  "twitter-client": "twitter_client",
  apify: "apify_api_token",
};

export function createSuperAppCredentialsRouter(
  deps: SuperAppCredentialsRouterDeps,
): Hono {
  const app = new Hono();
  app.use("*", requireSuperAdmin(deps.sessionSecret));

  app.get("/", async (c) => {
    const status = await deps.getRepo().getStatus();
    return c.json(status);
  });

  app.put("/linkedin-client", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = linkedinUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertLinkedInClient(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter-collector", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterCollectorUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertTwitterCollector(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter-client", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = twitterClientUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertTwitterClient(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/apify", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = apifyUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertApifyApiToken(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:key", async (c) => {
    const slug = c.req.param("key");
    const key = KEY_SLUG_TO_KEY[slug];
    if (key === undefined) {
      return c.json({ error: "invalid_key" }, 400);
    }
    const removed = await deps.getRepo().delete(key);
    return c.json({ ok: true, removed });
  });

  return app;
}
