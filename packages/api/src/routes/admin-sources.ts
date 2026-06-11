import { Hono } from "hono";
import { z } from "zod";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { SourcesRepo, SourceCreateInput } from "@api/repositories/sources.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const createSourceSchema = z.object({
  type: z.enum(["hn", "reddit", "twitter", "rss", "github", "blog", "newsletter", "web_search", "web"]),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

const updateEnabledSchema = z.object({
  enabled: z.boolean(),
});

export interface AdminSourcesRouterDeps {
  getSourcesRepo: (ctx: TenantContext) => SourcesRepo;
}

export function createAdminSourcesRouter(deps: AdminSourcesRouterDeps): Hono {
  const router = new Hono();

  // GET / — list all sources for the tenant
  router.get("/", async (c) => {
    const ctx = resolveTenantCtx(c);
    const repo = deps.getSourcesRepo(ctx);
    const sources = await repo.listForTenant();
    return c.json({ sources });
  });

  // POST / — create a new source
  router.post("/", async (c) => {
    const ctx = resolveTenantCtx(c);
    const body = await c.req.json().catch(() => null);
    const parsed = createSourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const repo = deps.getSourcesRepo(ctx);
    const source = await repo.create(parsed.data as SourceCreateInput);
    return c.json(source, 201);
  });

  // PATCH /:id — toggle enabled
  router.patch("/:id", async (c) => {
    const ctx = resolveTenantCtx(c);
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = updateEnabledSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const repo = deps.getSourcesRepo(ctx);
    const source = await repo.updateEnabled(id, parsed.data.enabled);
    if (!source) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(source);
  });

  // DELETE /:id — remove a source
  router.delete("/:id", async (c) => {
    const ctx = resolveTenantCtx(c);
    const id = c.req.param("id");
    const repo = deps.getSourcesRepo(ctx);
    const removed = await repo.delete(id);
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });

  return router;
}
