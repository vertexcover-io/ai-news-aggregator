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
      // Canon disabled for this tenant (Fix #4): the public Must Read page is
      // gone, so its data is too. App-host/legacy requests (no publicTenant)
      // are unaffected. Entries are retained in the DB (EDGE-014).
      const publicTenant = c.get("publicTenant");
      if (publicTenant !== undefined && !publicTenant.featureCanon) {
        return c.json([] satisfies PublicMustReadEntry[]);
      }
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
