import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared/tenant";
import type { TenantContext } from "@newsletter/shared/tenant";
import type { TenantRow } from "@newsletter/shared";
import type { TenantVariables } from "../../middleware/types.js";
import type { TenantsRepo } from "../../repositories/tenants.js";
import type { TenantBrandingPayload } from "../tenant-public.js";
import { createTenantPublicRouter } from "../tenant-public.js";

function brandingJson(res: Response): Promise<TenantBrandingPayload> {
  return res.json() as Promise<TenantBrandingPayload>;
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  const now = new Date();
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "acme",
    previousSlug: null,
    status: "active",
    name: "Acme News",
    headline: "All the Acme news",
    topicStrip: "AI · ML · Robotics",
    subtagline: "Daily digest",
    logoBytes: null,
    logoContentType: null,
    logoVersion: 0,
    customDomain: null,
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
    builtPageEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TenantRow;
}

function makeRepo(tenants: TenantRow[]): TenantsRepo {
  const notImpl = () => {
    throw new Error("not implemented");
  };
  return {
    create: notImpl,
    getById: (id: string) =>
      Promise.resolve(tenants.find((t) => t.id === id) ?? null),
    getBySlug: (slug: string) =>
      Promise.resolve(tenants.find((t) => t.slug === slug) ?? null),
    getByCustomDomain: notImpl,
    getByPreviousSlug: notImpl,
    list: notImpl,
    updateBranding: notImpl,
    updateStatus: notImpl,
    updateSlug: notImpl,
    isSlugAvailable: notImpl,
  } as unknown as TenantsRepo;
}

function makeApp(
  tenants: TenantRow[],
  vars: { tenantCtx?: TenantContext; tenantSlug?: string },
): Hono<{ Variables: TenantVariables }> {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    if (vars.tenantCtx) c.set("tenantCtx", vars.tenantCtx);
    if (vars.tenantSlug) c.set("tenantSlug", vars.tenantSlug);
    await next();
  });
  app.route("/", createTenantPublicRouter({ getTenantsRepo: () => makeRepo(tenants) }));
  return app;
}

function ctxFor(id: string): TenantContext {
  return { tenantId: id, role: "tenant_admin" };
}

describe("tenant-public /branding", () => {
  it("resolves via tenantCtx and returns branding slots", async () => {
    const tenant = makeTenant();
    const app = makeApp([tenant], { tenantCtx: ctxFor(tenant.id) });
    const res = await app.request("/branding");
    expect(res.status).toBe(200);
    const body = await brandingJson(res);
    expect(body).toMatchObject({
      name: "Acme News",
      headline: "All the Acme news",
      topicStrip: "AI · ML · Robotics",
      subtagline: "Daily digest",
      logoVersion: 0,
      hasLogo: false,
    });
  });

  it("resolves via tenantSlug when no ctx present", async () => {
    const tenant = makeTenant();
    const app = makeApp([tenant], { tenantSlug: "acme" });
    const res = await app.request("/branding");
    expect(res.status).toBe(200);
    const body = await brandingJson(res);
    expect(body.name).toBe("Acme News");
  });

  it("nav: mustRead reflects canonEnabled, built only for tenant 0", async () => {
    const canon = makeTenant({ canonEnabled: true });
    const app = makeApp([canon], { tenantCtx: ctxFor(canon.id) });
    const body = await brandingJson(await app.request("/branding"));
    expect(body.nav).toEqual({ sources: true, mustRead: true, built: false });
  });

  it("nav.built is true for AGENTLOOP tenant 0", async () => {
    const t0 = makeTenant({ id: AGENTLOOP_TENANT_ID, slug: "agentloop" });
    const app = makeApp([t0], { tenantCtx: ctxFor(AGENTLOOP_TENANT_ID) });
    const body = await brandingJson(await app.request("/branding"));
    expect(body.nav.built).toBe(true);
  });

  it("returns 404 for unknown host/slug (no leak)", async () => {
    const app = makeApp([makeTenant()], { tenantSlug: "ghost" });
    const res = await app.request("/branding");
    expect(res.status).toBe(404);
  });

  it("returns 404 when neither ctx nor slug is set", async () => {
    const app = makeApp([makeTenant()], {});
    const res = await app.request("/branding");
    expect(res.status).toBe(404);
  });
});

describe("tenant-public /logo", () => {
  it("serves bytes with content-type, cache-control and etag", async () => {
    const tenant = makeTenant({
      logoBytes: PNG_BASE64,
      logoContentType: "image/png",
      logoVersion: 3,
    });
    const app = makeApp([tenant], { tenantCtx: ctxFor(tenant.id) });
    const res = await app.request("/logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=31536000");
    expect(res.headers.get("etag")).toBe(`"logo-${tenant.id}-3"`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(Buffer.from(PNG_BASE64, "base64"))).toBe(true);
  });

  it("returns 304 when If-None-Match matches the etag", async () => {
    const tenant = makeTenant({
      logoBytes: PNG_BASE64,
      logoContentType: "image/png",
      logoVersion: 3,
    });
    const etag = `"logo-${tenant.id}-3"`;
    const app = makeApp([tenant], { tenantCtx: ctxFor(tenant.id) });
    const res = await app.request("/logo", {
      headers: { "if-none-match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
  });

  it("returns 200 when If-None-Match is stale (version bumped)", async () => {
    const tenant = makeTenant({
      logoBytes: PNG_BASE64,
      logoContentType: "image/png",
      logoVersion: 4,
    });
    const app = makeApp([tenant], { tenantCtx: ctxFor(tenant.id) });
    const res = await app.request("/logo", {
      headers: { "if-none-match": `"logo-${tenant.id}-3"` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when tenant has no logo", async () => {
    const tenant = makeTenant();
    const app = makeApp([tenant], { tenantCtx: ctxFor(tenant.id) });
    const res = await app.request("/logo");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown tenant (no leak)", async () => {
    const app = makeApp([makeTenant()], { tenantSlug: "ghost" });
    const res = await app.request("/logo");
    expect(res.status).toBe(404);
  });
});
