import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { PublicMustReadEntry } from "@newsletter/shared";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromPublicHost } from "@api/auth/tenant-scope.js";
import {
  createMustReadRepo,
  toPublicWire,
  type MustReadRepo,
} from "@api/repositories/must-read.js";

export interface PublicMustReadRouterDeps {
  getMustReadRepo: (scope?: TenantScope) => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicMustReadRouter(
  deps: PublicMustReadRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:must-read");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      // Canon entries fenced by the Host-resolved tenant (P7, REQ-044).
      const rows = await deps.getMustReadRepo(tenantScopeFromPublicHost(c)).listPublic();
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
    getMustReadRepo: (scope) => createMustReadRepo(defaultGetDb(), scope),
  });
}
