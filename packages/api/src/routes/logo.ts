import { Hono } from "hono";
import { createHash } from "node:crypto";
import type { TenantsRepo } from "@api/repositories/tenants.js";

export interface LogoRouterDeps {
  getTenantsRepo: () => TenantsRepo;
}

/**
 * Public logo route. Serves tenant logo bytes with correct Content-Type and
 * long-lived cache headers (Cache-Control: max-age=31536000, immutable + ETag).
 */
export function createLogoRouter(deps: LogoRouterDeps): Hono {
  const app = new Hono();

  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const repo = deps.getTenantsRepo();
    const tenant = await repo.findBySlug(slug);

    if (!tenant?.logoBytes || !tenant.logoContentType) {
      return c.notFound();
    }

    // Compute ETag as hex digest of logo bytes for conditional requests.
    const etag = `"${createHash("sha256").update(tenant.logoBytes).digest("hex")}"`;

    // Check conditional request — return 304 if the logo hasn't changed.
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch === etag) {
      c.status(304);
      return c.body(null);
    }

    return c.body(tenant.logoBytes, 200, {
      "Content-Type": tenant.logoContentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
    });
  });

  return app;
}
