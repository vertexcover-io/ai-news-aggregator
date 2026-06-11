import { Hono } from "hono";

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
}

export interface SuperAdminRouterDeps {
  /** List all tenants. Called only by super_admin. */
  getTenants?: () => Promise<TenantSummary[]>;
  /** Look up a single tenant by ID (for impersonation target validation). */
  getTenantById?: (id: string) => Promise<TenantSummary | null>;
  /** Begin impersonating a tenant. Implemented by the caller. */
  startImpersonation?: (tenantId: string) => Promise<void>;
  /** Exit impersonation. Implemented by the caller. */
  exitImpersonation?: () => Promise<void>;
}

export function createSuperAdminRouter(deps: SuperAdminRouterDeps): Hono {
  const router = new Hono();

  router.get("/tenants", async (c) => {
    if (!deps.getTenants) {
      return c.json({ tenants: [] });
    }
    const tenants = await deps.getTenants();
    return c.json({ tenants });
  });

  // IMPORTANT: /exit must be registered BEFORE /:tenantId so the literal path wins.
  router.post("/impersonate/exit", async (c) => {
    if (deps.exitImpersonation) {
      await deps.exitImpersonation();
    }
    return c.json({ ok: true });
  });

  router.post("/impersonate/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");

    if (deps.getTenantById) {
      const tenant = await deps.getTenantById(tenantId);
      if (!tenant) {
        return c.json({ error: "tenant not found" }, 404);
      }
    }

    if (deps.startImpersonation) {
      await deps.startImpersonation(tenantId);
    }

    return c.json({ ok: true, tenantId });
  });

  return router;
}
