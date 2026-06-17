/**
 * P7 unit: public branding routes (REQ-040 payload, REQ-043 logo headers).
 *
 * GET /api/branding      → TenantBranding for the Host-resolved tenant
 *                          (falls back to tenant 0 on the app host).
 * GET /api/branding/logo → Postgres-stored bytes with content-type,
 *                          long-lived Cache-Control and an ETag; 304 on
 *                          If-None-Match.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { createBrandingRouter } from "@api/routes/branding.js";
import type { TenantRow } from "@api/repositories/tenants.js";
import type { PublicTenantCtx } from "@api/middleware/resolve-tenant.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "inference",
    previousSlug: null,
    name: "The Inference",
    status: "active",
    customDomain: null,
    headline: "The daily read for people building with inference.",
    topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
    subtagline: "No funding rounds. Just the runtime.",
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildApp(
  tenant: TenantRow | null,
  publicTenant?: Pick<PublicTenantCtx, "tenantId" | "slug">,
): { app: Hono; findById: ReturnType<typeof vi.fn>; findBySlug: ReturnType<typeof vi.fn> } {
  const findById = vi.fn(() => Promise.resolve(tenant));
  const findBySlug = vi.fn(() => Promise.resolve(tenant));
  const app = new Hono();
  if (publicTenant) {
    app.use("*", async (c, next) => {
      // The branding router reads featureCanon off the tenant ROW, not the
      // public context, so a placeholder flag here is fine.
      c.set("publicTenant", { ...publicTenant, featureCanon: false });
      await next();
    });
  }
  app.route("/api/branding", createBrandingRouter({
    getTenantsRepo: () => ({ findById, findBySlug }),
  }));
  return { app, findById, findBySlug };
}

describe("GET /api/branding", () => {
  it("returns the Host-resolved tenant's branding with canon flag off and no logo", async () => {
    const tenant = makeTenant();
    const { app, findById } = buildApp(tenant, {
      tenantId: tenant.id,
      slug: tenant.slug,
    });
    const res = await app.request("/api/branding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenantBranding;
    expect(body).toEqual({
      name: "The Inference",
      headline: "The daily read for people building with inference.",
      topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
      subtagline: "No funding rounds. Just the runtime.",
      logoUrl: null,
      flags: { canon: false },
      isTenantZero: false,
    });
    expect(findById).toHaveBeenCalledWith(tenant.id);
  });

  it("falls back to tenant 0 (agentloop) when no public tenant is resolved (app host / dev)", async () => {
    const tenant = makeTenant({ slug: "agentloop", name: "AGENTLOOP", featureCanon: true });
    const { app, findBySlug } = buildApp(tenant);
    const res = await app.request("/api/branding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenantBranding;
    expect(body.isTenantZero).toBe(true);
    expect(body.flags.canon).toBe(true);
    expect(findBySlug).toHaveBeenCalledWith("agentloop");
  });

  it("includes a versioned logoUrl when the tenant has a stored logo", async () => {
    const tenant = makeTenant({ logoBytes: PNG_BYTES, logoContentType: "image/png" });
    const { app } = buildApp(tenant, { tenantId: tenant.id, slug: tenant.slug });
    const res = await app.request("/api/branding");
    const body = (await res.json()) as TenantBranding;
    expect(body.logoUrl).toMatch(/^\/api\/branding\/logo\?v=[0-9a-f]+$/);
  });

  it("404s when the tenant row has vanished", async () => {
    const { app } = buildApp(null, {
      tenantId: "22222222-2222-4222-8222-222222222222",
      slug: "ghost",
    });
    const res = await app.request("/api/branding");
    expect(res.status).toBe(404);
  });
});

describe("test_REQ_043_logo_served_with_content_type_and_cache", () => {
  it("serves the stored bytes with content-type, immutable cache-control and an ETag", async () => {
    const tenant = makeTenant({ logoBytes: PNG_BYTES, logoContentType: "image/png" });
    const { app } = buildApp(tenant, { tenantId: tenant.id, slug: tenant.slug });
    const res = await app.request("/api/branding/logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it("returns 304 with no body when If-None-Match matches the ETag", async () => {
    const tenant = makeTenant({ logoBytes: PNG_BYTES, logoContentType: "image/png" });
    const { app } = buildApp(tenant, { tenantId: tenant.id, slug: tenant.slug });
    const first = await app.request("/api/branding/logo");
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    const res = await app.request("/api/branding/logo", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("404s when the tenant has no logo", async () => {
    const tenant = makeTenant();
    const { app } = buildApp(tenant, { tenantId: tenant.id, slug: tenant.slug });
    const res = await app.request("/api/branding/logo");
    expect(res.status).toBe(404);
  });
});
