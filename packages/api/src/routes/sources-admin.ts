import { Hono } from "hono";
import { getTenantId } from "@api/middleware/tenant-host.js";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import {
  createSourcesRepo,
  type SourceCreateInput,
  type SourceRecord,
  type SourcesRepo,
  type SourceUpdateInput,
} from "@api/repositories/sources.js";
import {
  discoverBodySchema,
  sourceConfigSchemaByType,
  sourceCreateSchema,
  sourcePatchSchema,
} from "@api/lib/validate-sources.js";
import {
  createDefaultSourceDiscovery,
  SourceDiscoveryError,
  type SourceDiscovery,
} from "@api/services/source-discovery.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SourcesAdminRouterDeps {
  getSourcesRepo: (tenantId: string) => SourcesRepo;
  /** null/undefined ⇒ discovery is disabled (no TAVILY_API_KEY) — POST /discover returns 503. */
  discovery?: SourceDiscovery | null;
  logger?: ReturnType<typeof createLogger>;
}

function toWire(row: SourceRecord) {
  return {
    id: row.id,
    type: row.type,
    config: row.config,
    enabled: row.enabled,
    health: row.health,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createSourcesAdminRouter(deps: SourcesAdminRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:admin-sources");
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await deps.getSourcesRepo(getTenantId(c)).list();
    return c.json({ sources: rows.map(toWire) });
  });

  app.post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = sourceCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const row = await deps
      .getSourcesRepo(getTenantId(c))
      .create(parsed.data as SourceCreateInput);
    logger.info(
      { event: "admin-sources.created", sourceId: row.id, type: row.type },
      "source created",
    );
    return c.json(toWire(row), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = sourcePatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const repo = deps.getSourcesRepo(getTenantId(c));
    const existing = await repo.getById(id);
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    let config: SourceUpdateInput["config"];
    if (parsed.data.config !== undefined) {
      const configParsed = sourceConfigSchemaByType[existing.type].safeParse(
        parsed.data.config,
      );
      if (!configParsed.success) {
        return c.json({ error: "invalid_body", issues: configParsed.error.issues }, 400);
      }
      config = configParsed.data;
    }
    const updated = await repo.update(id, {
      ...(config !== undefined ? { config } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    });
    if (!updated) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(toWire(updated));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const removed = await deps.getSourcesRepo(getTenantId(c)).delete(id);
    if (!removed) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.body(null, 204);
  });

  // REQ-071: returns candidates only — never persists a source row.
  app.post("/discover", async (c) => {
    if (!deps.discovery) {
      return c.json(
        { error: "source_discovery_disabled", message: "TAVILY_API_KEY is not configured" },
        503,
      );
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = discoverBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    try {
      const candidates = await deps.discovery.discover(parsed.data.topic);
      return c.json({ candidates });
    } catch (err) {
      if (err instanceof SourceDiscoveryError) {
        logger.warn({ err, topic: parsed.data.topic }, "admin-sources.discover.failed");
        return c.json({ error: "discovery_failed", message: err.message }, 502);
      }
      throw err;
    }
  });

  return app;
}

export function createDefaultSourcesAdminRouter(): Hono {
  return createSourcesAdminRouter({
    getSourcesRepo: (tenantId) => createSourcesRepo(defaultGetDb(), tenantId),
    discovery: createDefaultSourceDiscovery({
      TAVILY_API_KEY: process.env.TAVILY_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }),
  });
}
