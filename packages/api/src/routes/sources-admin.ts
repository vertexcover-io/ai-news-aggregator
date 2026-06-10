import { Hono } from "hono";
import { z } from "zod";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import { tenantScoped, type ScopedTenantContext } from "@newsletter/shared/services";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";

const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "hn", "reddit", "twitter", "rss", "github", "blog", "newsletter", "web_search",
]);

const createSourceSchema = z.object({
  type: z.string().refine((v) => VALID_SOURCE_TYPES.has(v), { message: "invalid source type" }),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
});

const patchSourceSchema = z.object({
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
});

export interface SourcesAdminRouterDeps {
  getSourcesRepo: (scoped: ScopedTenantContext) => SourcesRepo;
  getDb: () => ReturnType<typeof defaultGetDb>;
  logger?: ReturnType<typeof createLogger>;
}

export function createSourcesAdminRouter(deps: SourcesAdminRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sources-admin");
  const app = new Hono();

  // Resolve per-request tenant context.
  function repo(c: { get: <T>(key: string) => T }): SourcesRepo {
    const ctx = c.get("tenantCtx") as { tenantId: string } | undefined;
    if (!ctx) throw new Error("tenantCtx not set — requireAuth must run first");
    return deps.getSourcesRepo(tenantScoped({ tenantId: ctx.tenantId, role: "tenant_admin" }));
  }

  // GET / — list all sources for the tenant
  app.get("/", async (c) => {
    const sources = await repo(c).list();
    return c.json(sources);
  });

  // POST / — create a new source
  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = createSourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }

    const source = await repo(c).create({
      type: parsed.data.type,
      config: parsed.data.config,
      enabled: parsed.data.enabled,
    });

    logger.info({ event: "sources.created", sourceId: source.id, type: source.type }, "source created");
    return c.json(source, 201);
  });

  // PATCH /:id — update source (toggle enabled, update config, update lastHealth)
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = patchSourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }

    const updated = await repo(c).update(id, parsed.data);
    if (!updated) {
      return c.json({ error: "not found" }, 404);
    }

    logger.info({ event: "sources.updated", sourceId: id }, "source updated");
    return c.json(updated);
  });

  // DELETE /:id — remove a source
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await repo(c).delete(id);
    if (!deleted) {
      return c.json({ error: "not found" }, 404);
    }
    logger.info({ event: "sources.deleted", sourceId: id }, "source deleted");
    return c.json({ ok: true });
  });

  return app;
}

export function createDefaultSourcesAdminRouter(): Hono {
  return createSourcesAdminRouter({
    getDb: () => defaultGetDb(),
    getSourcesRepo: (scoped) => createSourcesRepo(defaultGetDb(), scoped),
  });
}
