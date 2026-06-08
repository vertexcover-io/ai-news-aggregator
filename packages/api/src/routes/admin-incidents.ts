/**
 * Admin incidents routes (REQ-020, REQ-021, REQ-023).
 *
 * GET  /api/admin/incidents           — list incidents, filter by status/severity, newest-first.
 * PATCH /api/admin/incidents/:id      — update status (open | resolved | muted).
 *
 * Must be mounted behind requireAdmin (REQ-023).
 * Factory pattern mirrors admin-must-read.ts.
 */
import { Hono } from "hono";
import { z } from "zod";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { createIncidentRepo } from "@api/repositories/incidents.js";
import type { IncidentRepository } from "@newsletter/shared/alerting";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusSchema = z.enum(["open", "resolved", "muted"]);
const severitySchema = z.enum(["critical", "error", "warning", "info"]);

/** Zod schema for the PATCH body. */
const patchBodySchema = z.object({
  status: statusSchema,
});

/** Zod schema for GET query params. */
const listQuerySchema = z.object({
  status: statusSchema.optional(),
  severity: severitySchema.optional(),
});

export interface AdminIncidentsRouterDeps {
  getRepo: () => IncidentRepository;
}

export function createAdminIncidentsRouter(deps: AdminIncidentsRouterDeps): Hono {
  const app = new Hono();

  /**
   * GET /api/admin/incidents
   * Query params: status?, severity?
   * Returns: Incident[] newest-first.
   */
  app.get("/", async (c) => {
    const raw = {
      status: c.req.query("status"),
      severity: c.req.query("severity"),
    };
    const parsed = listQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
    }
    const filter = parsed.data;
    const repo = deps.getRepo();
    const rows = await repo.list(filter);
    return c.json(rows, 200);
  });

  /**
   * PATCH /api/admin/incidents/:id
   * Body: { status: "open" | "resolved" | "muted" }
   * Returns: updated Incident or 400/404.
   */
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const repo = deps.getRepo();
    const updated = await repo.setStatus(id, parsed.data.status);
    if (!updated) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(updated, 200);
  });

  return app;
}

export function createDefaultAdminIncidentsRouter(): Hono {
  return createAdminIncidentsRouter({
    getRepo: () => createIncidentRepo(defaultGetDb()),
  });
}
