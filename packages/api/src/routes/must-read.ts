import { Hono } from "hono";
import { getTenantId } from "@api/middleware/tenant-host.js";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { PublicMustReadEntry } from "@newsletter/shared";
import {
  createMustReadRepo,
  toPublicWire,
  type MustReadRepo,
} from "@api/repositories/must-read.js";

export interface PublicMustReadRouterDeps {
  getMustReadRepo: (tenantId: string) => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicMustReadRouter(
  deps: PublicMustReadRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:must-read");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const rows = await deps.getMustReadRepo(getTenantId(c)).listPublic();
      const body: PublicMustReadEntry[] = rows.map(toPublicWire);
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
    getMustReadRepo: (tenantId) => createMustReadRepo(defaultGetDb(), tenantId),
  });
}
