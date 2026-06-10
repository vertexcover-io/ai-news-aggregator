import { Hono } from "hono";
import { z } from "zod";
import type { TenantsRepo } from "@api/repositories/tenants.js";

const putSchema = z.object({
  featureCanon: z.boolean().optional(),
  featureDeliverability: z.boolean().optional(),
  featureEval: z.boolean().optional(),
}).partial();

export interface FeaturesRouterDeps {
  getTenantsRepo: () => TenantsRepo;
}

export function createFeaturesRouter(deps: FeaturesRouterDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const ctx = c.get("tenantCtx");
    const tenant = await deps.getTenantsRepo().findById(ctx.tenantId);
    if (!tenant) {
      return c.json({ error: "tenant not found" }, 404);
    }
    return c.json({
      featureCanon: tenant.featureCanon,
      featureDeliverability: tenant.featureDeliverability,
      featureEval: tenant.featureEval,
    });
  });

  app.put("/", async (c) => {
    const ctx = c.get("tenantCtx");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }

    const tenant = await deps.getTenantsRepo().updateFeatures(ctx.tenantId, parsed.data);

    return c.json({
      featureCanon: tenant.featureCanon,
      featureDeliverability: tenant.featureDeliverability,
      featureEval: tenant.featureEval,
    });
  });

  return app;
}
