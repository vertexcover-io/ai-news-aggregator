import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { PublicMustReadEntry } from "@newsletter/shared";
import {
  createMustReadRepo,
  type MustReadRepo,
} from "@api/repositories/must-read.js";

export interface PublicMustReadRouterDeps {
  getMustReadRepo: () => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicMustReadRouter(
  deps: PublicMustReadRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:must-read");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const rows = await deps.getMustReadRepo().listPublic();
      const body: PublicMustReadEntry[] = rows.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        author: r.author,
        year: r.year,
        annotation: r.annotation,
        addedAt: r.addedAt.toISOString(),
      }));
      return c.json(body);
    } catch (err) {
      logger.error({ err }, "must-read.list_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return app;
}

export function createDefaultPublicMustReadRouter(): Hono {
  return createPublicMustReadRouter({
    getMustReadRepo: () => createMustReadRepo(defaultGetDb()),
  });
}
