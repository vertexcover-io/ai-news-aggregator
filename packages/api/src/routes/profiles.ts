import { Hono } from "hono";
import { listProfiles as defaultListProfiles } from "@api/services/profiles.js";

export interface ProfilesRouterDeps {
  listProfiles?: typeof defaultListProfiles;
}

export function createProfilesRouter(deps: ProfilesRouterDeps = {}): Hono {
  const list = deps.listProfiles ?? defaultListProfiles;
  const app = new Hono();
  app.get("/", async (c) => {
    const profiles = await list();
    return c.json({ profiles });
  });
  return app;
}

export function createDefaultProfilesRouter(): Hono {
  return createProfilesRouter();
}
