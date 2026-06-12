import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { setTestTenant, TEST_TENANT_ID } from "../../helpers/tenant.js";
import { createTenantLogoRouter } from "@api/routes/tenant-config.js";
import { validateLogo } from "@api/lib/logo-validation.js";
import type { TenantLogoRecord } from "@api/repositories/tenants.js";

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

const svgLogo: TenantLogoRecord = {
  logo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  contentType: "image/svg+xml",
  logoVersion: 1,
};

// Cross-tenant review hardening: user-uploaded bytes served from the public
// origin must never execute as a document, and the host-resolved shared path
// must never be cross-tenant cacheable.
describe("tenant-logo response hardening (stored-XSS + cache-poisoning)", () => {
  it("serves uploaded SVG with X-Content-Type-Options: nosniff", async () => {
    const res = await logoApp(svgLogo).request("/api/public/tenant-logo");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sends Content-Disposition: attachment and a script-free CSP so SVG never runs inline", async () => {
    const res = await logoApp(svgLogo).request("/api/public/tenant-logo");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("caches the immutable logo with Vary: Host and a tenant-unique ETag", async () => {
    const res = await logoApp(svgLogo).request("/api/public/tenant-logo");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("host");
    // Two tenants at the same logoVersion must not share an ETag, or
    // If-None-Match revalidation can 304 across tenants on a shared cache.
    expect(res.headers.get("etag")).toBe(`"${TEST_TENANT_ID}-v1"`);
  });

  it("keeps the hardening headers on the 304 revalidation path", async () => {
    const res = await logoApp(svgLogo).request("/api/public/tenant-logo", {
      headers: { "if-none-match": `"${TEST_TENANT_ID}-v1"` },
    });
    expect(res.status).toBe(304);
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("host");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("validateLogo SVG scan resists denylist evasion", () => {
  it("rejects an SVG with an HTML-entity-encoded javascript: href", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="&#106;avascript:alert(1)"><text>x</text></a></svg>';
    expect(validateLogo(new TextEncoder().encode(svg))).toEqual({
      ok: false,
      reason: "unsafe_svg",
    });
  });

  it("rejects hex-entity and &colon;-obfuscated javascript: payloads", () => {
    const hex =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#x6A;avascript:alert(1)">x</a></svg>';
    const colon =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript&colon;alert(1)">x</a></svg>';
    expect(validateLogo(new TextEncoder().encode(hex))).toEqual({
      ok: false,
      reason: "unsafe_svg",
    });
    expect(validateLogo(new TextEncoder().encode(colon))).toEqual({
      ok: false,
      reason: "unsafe_svg",
    });
  });

  it("rejects foreignObject (HTML smuggling) and SMIL animation of event handlers", () => {
    const foreign =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>';
    const smil =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect><set attributeName="onmouseover" to="alert(1)"/></rect></svg>';
    expect(validateLogo(new TextEncoder().encode(foreign))).toEqual({
      ok: false,
      reason: "unsafe_svg",
    });
    expect(validateLogo(new TextEncoder().encode(smil))).toEqual({
      ok: false,
      reason: "unsafe_svg",
    });
  });

  it("still accepts a benign SVG that uses entities in text content", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Fish &amp; Chips &gt; salad</text></svg>';
    expect(validateLogo(new TextEncoder().encode(svg))).toEqual({
      ok: true,
      contentType: "image/svg+xml",
    });
  });
});
