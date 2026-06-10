import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { TenantsRepo } from "../../repositories/tenants.js";
import { createResolveTenant } from "../resolve-tenant.js";
import type { TenantSelect } from "@newsletter/shared/db";

function makeTenant(overrides: Partial<TenantSelect> = {}): TenantSelect {
  return {
    id: "t-test-1",
    slug: "testco",
    name: "Test Co",
    status: "active",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: null,
    oldSlug: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as TenantSelect;
}

function makeTenantsRepo(
  opts: {
    findBySlug?: TenantsRepo["findBySlug"];
    findByCustomDomain?: TenantsRepo["findByCustomDomain"];
    findByOldSlug?: TenantsRepo["findByOldSlug"];
    findById?: TenantsRepo["findById"];
  } = {},
): TenantsRepo {
  return {
    findById: opts.findById ?? vi.fn().mockResolvedValue(null),
    findBySlug: opts.findBySlug ?? vi.fn().mockResolvedValue(null),
    findByCustomDomain: opts.findByCustomDomain ?? vi.fn().mockResolvedValue(null),
    findByOldSlug: opts.findByOldSlug ?? vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeTenant()),
    listAll: vi.fn().mockResolvedValue([]),
    updateDomain: vi.fn().mockResolvedValue(makeTenant()),
  };
}

describe("resolve-tenant middleware", () => {
  // ── REQ-020: app-host uses session tenant ─────────────────────────────────

  describe("app host", () => {
    it("test_REQ_020_app_host_uses_session_tenant", async () => {
      const tenantsRepo = makeTenantsRepo();
      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => {
        // App host: resolver is a no-op — tenantCtx is NOT set here.
        // It will be set later by requireAuth/requireAdmin via the session cookie.
        // We return a flag to prove the route still runs (no 404).
        return c.json({ reached: true });
      });

      const res = await app.request("https://app.vertexcover.io/test");
      expect(res.status).toBe(200);
      const body = await res.json() as { reached: boolean };
      expect(body.reached).toBe(true);
    });
  });

  // ── REQ-021: slug host resolves tenant ────────────────────────────────────

  describe("slug host", () => {
    it("test_REQ_021_slug_host_resolves_tenant", async () => {
      const tenant = makeTenant({ slug: "testco", id: "t-test-1" });
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(tenant),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => {
        const ctx = c.get("tenantCtx");
        return c.json(ctx);
      });

      const res = await app.request("https://testco.vertexcover.io/test");
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string; role: string; userId?: string };
      expect(body.tenantId).toBe("t-test-1");
      // Public routes: no userId but a role is set
      expect(body.role).toBeDefined();
      expect(body.userId).toBeUndefined();
    });

    it("test_EDGE_013_unknown_slug_notfound_no_leak", async () => {
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(null),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("https://nonexistent.vertexcover.io/test");
      // Should return 404 — unknown slug should not leak data
      expect(res.status).toBe(404);
    });
  });

  // ── REQ-022: custom domain maps to tenant 0 ───────────────────────────────

  describe("custom domain", () => {
    it("test_REQ_022_custom_domain_maps_tenant0", async () => {
      // AGENTLOOP's custom domain resolves to tenant 0 via hardcoded map
      const tenant0 = makeTenant({ slug: "agentloop", id: "t-tenant-0" });
      const tenantsRepo = makeTenantsRepo({
        findByCustomDomain: vi.fn().mockResolvedValue(tenant0),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: { "agentloop.io": "CUSTOM_TENANT_0" },
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => {
        const ctx = c.get("tenantCtx");
        return c.json(ctx);
      });

      const res = await app.request("https://agentloop.io/test");
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe("t-tenant-0");
    });

    it("test_REQ_021_unknown_custom_domain_notfound", async () => {
      const tenantsRepo = makeTenantsRepo({
        findByCustomDomain: vi.fn().mockResolvedValue(null),
        findBySlug: vi.fn().mockResolvedValue(null),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("https://unknown-random-domain.example/test");
      // Unknown host that's not app, not slug, not custom → 404
      expect(res.status).toBe(404);
    });
  });

  // ── REQ-023: old slug 301 redirects ──────────────────────────────────────

  describe("old slug redirect", () => {
    it("test_REQ_023_old_slug_301_redirects", async () => {
      const newTenant = makeTenant({ slug: "newslug", id: "t-new-1" });
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(null),
        findByOldSlug: vi.fn().mockResolvedValue(newTenant),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("https://oldslug.vertexcover.io/test");
      expect(res.status).toBe(301);
      // Should redirect to the new slug host, preserving the path
      const location = res.headers.get("location");
      expect(location).toBe("https://newslug.vertexcover.io/test");
    });
  });

  // ── dev override: X-Tenant-Slug header ───────────────────────────────────

  describe("dev override", () => {
    it("X-Tenant-Slug header resolves tenant without DNS", async () => {
      const tenant = makeTenant({ slug: "devco", id: "t-dev-1" });
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(tenant),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => {
        const ctx = c.get("tenantCtx");
        return c.json(ctx);
      });

      // Request to localhost with X-Tenant-Slug header
      const res = await app.request("http://localhost:3000/test", {
        headers: { "x-tenant-slug": "devco" },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe("t-dev-1");
    });

    it("X-Tenant-Slug with unknown slug returns 404", async () => {
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(null),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "vertexcover.io",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("http://localhost:3000/test", {
        headers: { "x-tenant-slug": "nope" },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── lvh.me wildcard DNS for local dev ────────────────────────────────────

  describe("lvh.me wildcard", () => {
    it("slug.lvh.me resolves tenant", async () => {
      const tenant = makeTenant({ slug: "lvhco", id: "t-lvh-1" });
      const tenantsRepo = makeTenantsRepo({
        findBySlug: vi.fn().mockResolvedValue(tenant),
      });

      const resolver = createResolveTenant({
        tenantsRepo,
        appHost: "app.vertexcover.io",
        rootDomain: "lvh.me",
        customDomainMap: {},
      });

      const app = new Hono();
      app.use("*", resolver);
      app.get("/test", (c) => {
        const ctx = c.get("tenantCtx");
        return c.json(ctx);
      });

      const res = await app.request("https://lvhco.lvh.me:3000/test");
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe("t-lvh-1");
    });
  });
});
