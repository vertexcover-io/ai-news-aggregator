/**
 * Host→tenant resolver — DB-driven custom web domain path (Fix #3, Phase C).
 * A host that isn't the app host, the env custom map, or `<slug>.<root>` is
 * resolved against findByCustomDomain (verified only), with a short TTL cache.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { TenantRow } from "@newsletter/shared/db";
import { loadDomainConfig } from "../../../src/config/domains";
import { createResolveTenant } from "../../../src/middleware/resolve-tenant";

const config = loadDomainConfig({ ROOT_DOMAIN: "agentloop.live", NODE_ENV: "production" });

function tenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "t-custom",
    slug: "inference",
    status: "active",
    featureCanon: false,
    customDomain: "news.acme.com",
    customDomainStatus: "verified",
    ...overrides,
  } as unknown as TenantRow;
}

function appWith(repo: {
  findBySlug: ReturnType<typeof vi.fn>;
  findByPreviousSlug: ReturnType<typeof vi.fn>;
  findByCustomDomain: ReturnType<typeof vi.fn>;
}, now: () => number = () => 1000): Hono {
  const app = new Hono();
  app.use(
    "*",
    createResolveTenant({ config, getTenantsRepo: () => repo, now }),
  );
  app.get("/x", (c) => {
    const pt = c.get("publicTenant");
    return pt ? c.json({ tenantId: pt.tenantId, slug: pt.slug }) : c.json({ none: true });
  });
  return app;
}

describe("resolver custom web domain (DB-driven)", () => {
  it("serves a tenant for a VERIFIED custom domain", async () => {
    const repo = {
      findBySlug: vi.fn(() => Promise.resolve(null)),
      findByPreviousSlug: vi.fn(() => Promise.resolve(null)),
      findByCustomDomain: vi.fn(() => Promise.resolve(tenant())),
    };
    const res = await appWith(repo).request("/x", { headers: { host: "news.acme.com" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: "t-custom", slug: "inference" });
    expect(repo.findByCustomDomain).toHaveBeenCalledWith("news.acme.com");
  });

  it("404s an unknown host (no matching custom domain)", async () => {
    const repo = {
      findBySlug: vi.fn(() => Promise.resolve(null)),
      findByPreviousSlug: vi.fn(() => Promise.resolve(null)),
      findByCustomDomain: vi.fn(() => Promise.resolve(null)),
    };
    const res = await appWith(repo).request("/x", { headers: { host: "stranger.example" } });
    expect(res.status).toBe(404);
  });

  it("caches the lookup within the TTL (one DB hit for repeat requests)", async () => {
    const repo = {
      findBySlug: vi.fn(() => Promise.resolve(null)),
      findByPreviousSlug: vi.fn(() => Promise.resolve(null)),
      findByCustomDomain: vi.fn(() => Promise.resolve(tenant())),
    };
    const app = appWith(repo, () => 5000);
    await app.request("/x", { headers: { host: "news.acme.com" } });
    await app.request("/x", { headers: { host: "news.acme.com" } });
    expect(repo.findByCustomDomain).toHaveBeenCalledOnce();
  });
});
