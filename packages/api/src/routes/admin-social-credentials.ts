import { Hono } from "hono";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  linkedinUpsertSchema,
  twitterUpsertSchema,
} from "@api/lib/validate-social-credentials.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@api/repositories/social-credentials.js";

export interface AdminSocialCredentialsRouterDeps {
  getRepo: () => SocialCredentialsRepo;
}

export function createAdminSocialCredentialsRouter(
  deps: AdminSocialCredentialsRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = await deps.getRepo().getStatus();
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
    const { updatedAt } = await deps.getRepo().upsertLinkedIn(parsed.data);
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
    const { updatedAt } = await deps.getRepo().upsertTwitter(parsed.data);
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:platform", async (c) => {
    const platform = c.req.param("platform");
    if (platform !== "linkedin" && platform !== "twitter") {
      return c.json({ error: "invalid_platform" }, 400);
    }
    const removed = await deps.getRepo().delete(platform);
    return c.json({ ok: true, removed });
  });

  return app;
}

export function createDefaultAdminSocialCredentialsRouter(): Hono {
  return createAdminSocialCredentialsRouter({
    getRepo: () =>
      createSocialCredentialsRepo(defaultGetDb(), getCredentialCipher()),
  });
}
