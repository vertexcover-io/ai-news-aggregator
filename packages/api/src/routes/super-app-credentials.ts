import { Hono } from "hono";
import type { AppCredentialsRepo } from "@api/repositories/app-credentials.js";

export interface SuperAppCredentialsRouterDeps {
  getRepo: () => AppCredentialsRepo;
}

const PLATFORM_SLUG_TO_KEY: Record<string, "linkedin" | "twitter" | "twitter_collector"> = {
  linkedin: "linkedin",
  twitter: "twitter",
  "twitter-collector": "twitter_collector",
};

export function createSuperAppCredentialsRouter(
  deps: SuperAppCredentialsRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = await deps.getRepo().getStatus();
    return c.json(status);
  });

  app.put("/linkedin", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.clientId !== "string" || !body.clientId.trim() ||
        typeof body.clientSecret !== "string" || !body.clientSecret.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertLinkedIn({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      apiVersion: typeof body.apiVersion === "string" ? body.apiVersion : undefined,
    });
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.clientId !== "string" || !body.clientId.trim() ||
        typeof body.clientSecret !== "string" || !body.clientSecret.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertTwitter({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.put("/twitter-collector", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.apiKey !== "string" || !body.apiKey.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { updatedAt } = await deps.getRepo().upsertTwitterCollector({ apiKey: body.apiKey });
    return c.json({ ok: true, configured: true, updatedAt });
  });

  app.delete("/:platform", async (c) => {
    const slug = c.req.param("platform");
    const key = PLATFORM_SLUG_TO_KEY[slug] as typeof PLATFORM_SLUG_TO_KEY[string] | undefined;
    if (key === undefined) {
      return c.json({ error: "invalid_platform" }, 400);
    }
    const removed = await deps.getRepo().delete(key);
    return c.json({ ok: true, removed });
  });

  return app;
}
