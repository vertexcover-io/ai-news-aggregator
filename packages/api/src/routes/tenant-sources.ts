/**
 * Tenant source management routes (P8, REQ-070/072/074) — auth-gated,
 * mounted at /api/sources behind requireAuth (the public, ungated sources
 * summary lives at /api/sources/summary in routes/sources.ts).
 *
 *   GET    /          → { sources: TenantSourceWire[] }
 *   POST   /          → 201 TenantSourceWire (manual add: { type, value })
 *   PATCH  /:id       → TenantSourceWire (enable/disable toggle)
 *   DELETE /:id       → { ok: true }
 *
 * Thin handlers (S-api-03): zod at the boundary, config building delegated
 * to the shared `buildSourceConfig`, persistence to the sources repo.
 */
import { Hono } from "hono";
import { z } from "zod";
import { getDb as defaultGetDb } from "@newsletter/shared";
import {
  buildSourceConfig,
  MANUAL_SOURCE_TYPES,
} from "@newsletter/shared/types";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createSourcesRepo,
  toSourceWire as toWire,
  type SourcesRepo,
} from "@api/repositories/sources.js";

export interface TenantSourcesRouterDeps {
  getRepo: (scope?: TenantScope) => SourcesRepo;
}

const createSchema = z.object({
  type: z.enum(MANUAL_SOURCE_TYPES),
  value: z.string().max(2048).default(""),
});

const patchSchema = z.object({
  enabled: z.boolean(),
});

export function createTenantSourcesRouter(
  deps: TenantSourcesRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await deps.getRepo(tenantScopeFromContext(c)).list();
    return c.json({ sources: rows.map(toWire) });
  });

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    let config;
    try {
      config = buildSourceConfig(parsed.data.type, parsed.data.value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid source";
      return c.json({ error: message }, 400);
    }
    const row = await deps
      .getRepo(tenantScopeFromContext(c))
      .create({ type: parsed.data.type, config });
    return c.json(toWire(row), 201);
  });

  app.patch("/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const row = await deps
      .getRepo(tenantScopeFromContext(c))
      .setEnabled(c.req.param("id"), parsed.data.enabled);
    if (row === null) return c.json({ error: "not found" }, 404);
    return c.json(toWire(row));
  });

  app.delete("/:id", async (c) => {
    const deleted = await deps
      .getRepo(tenantScopeFromContext(c))
      .delete(c.req.param("id"));
    if (!deleted) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}

export function createDefaultTenantSourcesRouter(): Hono {
  return createTenantSourcesRouter({
    getRepo: (scope) => createSourcesRepo(defaultGetDb(), scope),
  });
}
