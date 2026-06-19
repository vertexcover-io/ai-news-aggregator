import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { blockPublicContentOnAppHost } from "@api/middleware/resolve-tenant.js";
import type { PublicTenantCtx } from "@api/middleware/resolve-tenant.js";

/**
 * The guard for public CONTENT routes: it must 404 on the app host (so the
 * platform surface never serves the unscoped, all-tenants legacy result), while
 * tenant hosts and genuine legacy single-tenant requests pass straight through.
 */
function buildApp(
  setup: (c: import("hono").Context) => void,
): Hono {
  const app = new Hono();
  // Stand in for the P5 resolver: set whatever context the case needs.
  app.use("*", async (c, next) => {
    setup(c);
    await next();
  });
  app.use("/content/*", blockPublicContentOnAppHost);
  app.get("/content/home", (c) => c.json({ ok: true }));
  return app;
}

const TENANT: PublicTenantCtx = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  slug: "acme",
  featureCanon: false,
};

describe("blockPublicContentOnAppHost", () => {
  it("404s public content on the app host (appHost flag set)", async () => {
    const app = buildApp((c) => {
      c.set("appHost", true);
    });
    const res = await app.request("http://app.example.test/content/home");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("passes through on a tenant host (publicTenant set, no appHost)", async () => {
    const app = buildApp((c) => {
      c.set("publicTenant", TENANT);
    });
    const res = await app.request("http://acme.example.test/content/home");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("passes through in legacy single-tenant mode (no flags set)", async () => {
    const app = buildApp(() => {
      /* resolver not mounted — neither flag is set */
    });
    const res = await app.request("http://localhost/content/home");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
