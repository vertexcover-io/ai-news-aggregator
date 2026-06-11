import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { PublicMustReadEntry } from "@newsletter/shared";
import {
  createMustReadRepo,
  toPublicWire,
  type MustReadRepo,
} from "@api/repositories/must-read.js";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface PublicMustReadRouterDeps {
  getMustReadRepo: (ctx: TenantContext) => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicMustReadRouter(
  deps: PublicMustReadRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:must-read");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const rows = await deps.getMustReadRepo(resolveTenantCtx(c)).listPublic();
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
    getMustReadRepo: (ctx) => createMustReadRepo(defaultGetDb(), ctx),
  });
}
