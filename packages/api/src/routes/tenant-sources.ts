import { Hono } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { SourceRow, SourceType, TenantContext } from "@newsletter/shared";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared/tenant";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import type { TenantVariables } from "@api/middleware/types.js";

const SOURCE_TYPES = [
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
  "newsletter",
  "web_search",
] as const satisfies readonly SourceType[];

const addSourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

const setEnabledSchema = z.object({
  enabled: z.boolean(),
});

const discoverQuerySchema = z.object({
  query: z.string().trim().min(1).max(400),
  type: z.enum(SOURCE_TYPES).optional(),
});

export interface SourceCandidate {
  type: SourceType;
  title: string;
  url: string;
}

export interface SourceDiscoverInput {
  query: string;
  type?: SourceType;
  ctx: TenantContext;
}

export interface TenantSourcesRouterDeps {
  getSourcesRepo: (ctx: TenantContext) => SourcesRepo;
  discoverSources?: (input: SourceDiscoverInput) => Promise<SourceCandidate[]>;
  logger?: ReturnType<typeof createLogger>;
}

function resolveCtx(ctx: TenantContext | undefined): TenantContext {
  return ctx ?? { tenantId: AGENTLOOP_TENANT_ID, role: "tenant_admin" };
}

export function createTenantSourcesRouter(
  deps: TenantSourcesRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const logger = deps.logger ?? createLogger("api:tenant-sources");
  const app = new Hono<{ Variables: TenantVariables }>();

  app.get("/", async (c) => {
    const ctx = resolveCtx(c.get("tenantCtx"));
    const rows = await deps.getSourcesRepo(ctx).listForTenant();
    return c.json(rows);
  });

  app.get("/discover", async (c) => {
    const ctx = resolveCtx(c.get("tenantCtx"));
    const parsed = discoverQuerySchema.safeParse({
      query: c.req.query("query"),
      type: c.req.query("type"),
    });
    if (!parsed.success) {
      return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
    }
    if (!deps.discoverSources) {
      return c.json({ candidates: [] });
    }
    try {
      const candidates = await deps.discoverSources({
        query: parsed.data.query,
        type: parsed.data.type,
        ctx,
      });
      return c.json({ candidates });
    } catch (err) {
      logger.error({ err }, "tenant_sources.discover_failed");
      return c.json({ error: "discovery_failed" }, 502);
    }
  });

  app.post("/", async (c) => {
    const ctx = resolveCtx(c.get("tenantCtx"));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = addSourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const row = await deps.getSourcesRepo(ctx).add({
      type: parsed.data.type,
      config: parsed.data.config,
      ...(parsed.data.enabled !== undefined
        ? { enabled: parsed.data.enabled }
        : {}),
    });
    return c.json(row, 201);
  });

  app.patch("/:id", async (c) => {
    const ctx = resolveCtx(c.get("tenantCtx"));
    const id = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = setEnabledSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    // setEnabled is tenant-scoped: a cross-tenant/unknown id matches no row and
    // returns undefined at runtime. SourcesRepo.setEnabled types its return as
    // SourceRow (non-nullable), so the missing-row 404 (REQ-013) cannot be
    // expressed without widening that return to SourceRow | undefined —
    // DEFERRED TO BARRIER. Until then a missing row serializes as null.
    const row = (await deps
      .getSourcesRepo(ctx)
      .setEnabled(id, parsed.data.enabled)) as SourceRow | undefined;
    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(row);
  });

  app.delete("/:id", async (c) => {
    const ctx = resolveCtx(c.get("tenantCtx"));
    const id = c.req.param("id");
    await deps.getSourcesRepo(ctx).remove(id);
    return c.json({ ok: true });
  });

  return app;
}

export function createDefaultTenantSourcesRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createTenantSourcesRouter({
    getSourcesRepo: (ctx) => createSourcesRepo(defaultGetDb(), ctx),
  });
}
