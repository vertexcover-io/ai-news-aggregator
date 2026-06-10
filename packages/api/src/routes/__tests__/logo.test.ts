import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createLogoRouter } from "../logo.js";
import type { TenantsRepo } from "../../repositories/tenants.js";

interface TenantRowStub {
  id: string;
  slug: string;
  logoBytes: Uint8Array | null;
  logoContentType: string | null;
}

function makeTenantRow(overrides: Partial<TenantRowStub> = {}): TenantRowStub {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "test-tenant",
    logoBytes: null,
    logoContentType: null,
    ...overrides,
  };
}

function buildLogoApp(repo: TenantsRepo): Hono {
  const app = new Hono();
  app.route("/api/logo", createLogoRouter({ getTenantsRepo: () => repo }));
  return app;
}

describe("GET /api/logo/:slug", () => {
  it("returns 404 when tenant not found", async () => {
    const repo = {
      findBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as TenantsRepo;
    const app = buildLogoApp(repo);
    const res = await app.request("/api/logo/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 404 when tenant has no logo (REQ-043)", async () => {
    const repo = {
      findBySlug: vi.fn().mockResolvedValue(makeTenantRow()),
    } as unknown as TenantsRepo;
    const app = buildLogoApp(repo);
    const res = await app.request("/api/logo/test-tenant");
    expect(res.status).toBe(404);
  });

  it("serves logo bytes with correct Content-Type (REQ-043)", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const repo = {
      findBySlug: vi
        .fn()
        .mockResolvedValue(
          makeTenantRow({
            logoBytes: pngBytes,
            logoContentType: "image/png",
          }),
        ),
    } as unknown as TenantsRepo;
    const app = buildLogoApp(repo);
    const res = await app.request("/api/logo/test-tenant");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(pngBytes);
  });

  it("sets Cache-Control and ETag headers (REQ-043)", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const repo = {
      findBySlug: vi
        .fn()
        .mockResolvedValue(
          makeTenantRow({
            logoBytes: pngBytes,
            logoContentType: "image/png",
          }),
        ),
    } as unknown as TenantsRepo;
    const app = buildLogoApp(repo);
    const res = await app.request("/api/logo/test-tenant");
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control");
    expect(cc).not.toBeNull();
    expect(cc?.toLowerCase()).toContain("max-age");
    const etag = res.headers.get("etag");
    expect(etag).not.toBeNull();
    expect(etag?.length ?? 0).toBeGreaterThan(0);
  });

  it("serves SVG with image/svg+xml content type (REQ-043)", async () => {
    const svgBytes = new TextEncoder().encode("<svg></svg>");
    const repo = {
      findBySlug: vi
        .fn()
        .mockResolvedValue(
          makeTenantRow({
            logoBytes: svgBytes,
            logoContentType: "image/svg+xml",
          }),
        ),
    } as unknown as TenantsRepo;
    const app = buildLogoApp(repo);
    const res = await app.request("/api/logo/test-tenant");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });
});
