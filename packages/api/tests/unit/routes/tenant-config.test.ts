import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { setTestTenant } from "../../helpers/tenant.js";
import {
  createTenantConfigRouter,
  createTenantLogoRouter,
  TENANT_ZERO_BRANDING_DEFAULTS,
} from "@api/routes/tenant-config.js";
import type {
  TenantBrandingRecord,
  TenantLogoRecord,
} from "@api/repositories/tenants.js";

function brandingRow(
  overrides: Partial<TenantBrandingRecord> = {},
): TenantBrandingRecord {
  return {
    id: TENANT_ZERO_ID,
    slug: "agentloop",
    name: "AGENTLOOP",
    status: "active",
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoVersion: 0,
    canonEnabled: true,
    deliverabilityEnabled: false,
    evalEnabled: false,
    ...overrides,
  };
}

function configApp(row: TenantBrandingRecord | null, tenantId?: string): Hono {
  const app = new Hono();
  app.use("*", setTestTenant(tenantId ?? row?.id ?? TENANT_ZERO_ID));
  app.route(
    "/api/public/tenant-config",
    createTenantConfigRouter({
      tenantsRepo: { getBranding: vi.fn(() => Promise.resolve(row)) },
    }),
  );
  return app;
}

function logoApp(logo: TenantLogoRecord | null): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  app.route(
    "/api/public/tenant-logo",
    createTenantLogoRouter({
      tenantsRepo: { getLogo: vi.fn(() => Promise.resolve(logo)) },
    }),
  );
  return app;
}

describe("GET /api/public/tenant-config", () => {
  it("serves AGENTLOOP defaults for tenant 0 when branding columns are null (REQ-122)", async () => {
    const res = await configApp(brandingRow()).request(
      "/api/public/tenant-config",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "AGENTLOOP",
      slug: "agentloop",
      headline: TENANT_ZERO_BRANDING_DEFAULTS.headline,
      topicStrip: TENANT_ZERO_BRANDING_DEFAULTS.topicStrip,
      subtagline: TENANT_ZERO_BRANDING_DEFAULTS.subtagline,
      logoVersion: 0,
      flags: { canon: true, built: true, deliverability: false },
    });
  });

  it("serves a custom tenant's branding with no AGENTLOOP defaults and built=false", async () => {
    const tenantId = randomUUID();
    const row = brandingRow({
      id: tenantId,
      slug: "the-inference",
      name: "The Inference",
      headline: "The daily read for people building with inference.",
      topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
      subtagline: null,
      logoVersion: 3,
      canonEnabled: false,
      deliverabilityEnabled: true,
    });
    const res = await configApp(row).request("/api/public/tenant-config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      name: "The Inference",
      slug: "the-inference",
      headline: "The daily read for people building with inference.",
      topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
      subtagline: null,
      logoVersion: 3,
      flags: { canon: false, built: false, deliverability: true },
    });
    expect(JSON.stringify(body)).not.toContain("AGENTLOOP");
  });

  it("tenant-set branding on tenant 0 overrides the defaults", async () => {
    const row = brandingRow({ headline: "Custom headline." });
    const res = await configApp(row).request("/api/public/tenant-config");
    const body = (await res.json()) as { headline: string };
    expect(body.headline).toBe("Custom headline.");
  });

  it("404s when the tenant row is missing", async () => {
    const res = await configApp(null, randomUUID()).request(
      "/api/public/tenant-config",
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/public/tenant-logo", () => {
  const stored: TenantLogoRecord = {
    logo: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
    logoVersion: 4,
  };

  it("serves stored bytes with content-type, tenant-versioned ETag, and immutable cache headers (REQ-043)", async () => {
    const res = await logoApp(stored).request("/api/public/tenant-logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBe(`"${TENANT_ZERO_ID}-v4"`);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("returns 304 with cache headers when If-None-Match matches the version", async () => {
    const res = await logoApp(stored).request("/api/public/tenant-logo", {
      headers: { "if-none-match": `"${TENANT_ZERO_ID}-v4"` },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(`"${TENANT_ZERO_ID}-v4"`);
  });

  it("serves a full 200 when If-None-Match carries a stale version", async () => {
    const res = await logoApp(stored).request("/api/public/tenant-logo", {
      headers: { "if-none-match": `"${TENANT_ZERO_ID}-v3"` },
    });
    expect(res.status).toBe(200);
  });

  it("404s when the tenant has no logo (web falls back to the default mark)", async () => {
    const res = await logoApp(null).request("/api/public/tenant-logo");
    expect(res.status).toBe(404);
  });
});
