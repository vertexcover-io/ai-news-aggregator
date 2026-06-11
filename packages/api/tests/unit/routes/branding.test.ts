import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createBrandingRouter, createLogoRouter } from "@api/routes/branding.js";

function fakeBrandingRepo(overrides: Record<string, unknown> = {}) {
  return {
    getBranding: () => Promise.resolve({
      name: "Test Tenant",
      headline: "My Headline",
      topicStrip: "AI, Tech",
      subtagline: "Subtitle",
      logoContentType: "image/png",
      slug: "test",
      featureCanon: true,
      featureDeliverability: false,
      featureEval: false,
      ...overrides,
    }),
    getLogo: () => Promise.resolve({
      logoBytes: Buffer.from("fake-png"),
      logoContentType: "image/png",
      ...overrides,
    }),
  };
}

describe("Phase 7: Branding + logo routes", () => {
  it("REQ-040: branding endpoint returns tenant branding shape", async () => {
    const router = createBrandingRouter({ brandingRepo: fakeBrandingRepo() });
    const app = new Hono();
    app.route("/api/branding", router);

    const res = await app.request("/api/branding", {
      headers: { host: "test.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test Tenant");
    expect(body.headline).toBe("My Headline");
    expect(body.logoUrl).toBe("/logo");
    expect(body.flags.canon).toBe(true);
    expect(typeof body.isTenantZero).toBe("boolean");
  });

  it("REQ-043: logo route returns content-type and cache headers", async () => {
    const router = createLogoRouter({ brandingRepo: fakeBrandingRepo() });
    const app = new Hono();
    app.route("/logo", router);

    const res = await app.request("/logo", {
      headers: { host: "test.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("max-age");
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("REQ-043: logo route returns 304 on matching etag", async () => {
    const router = createLogoRouter({ brandingRepo: fakeBrandingRepo() });
    const app = new Hono();
    app.route("/logo", router);

    const res1 = await app.request("/logo", { headers: { host: "test.vertexcover.io" } });
    const etag = res1.headers.get("ETag");

    const res2 = await app.request("/logo", {
      headers: { host: "test.vertexcover.io", "if-none-match": etag! },
    });
    expect(res2.status).toBe(304);
  });

  it("REQ-043: logo route returns 404 when no logo set", async () => {
    const router = createLogoRouter({
      brandingRepo: fakeBrandingRepo({ logoBytes: null, logoContentType: null }),
    });
    const app = new Hono();
    app.route("/logo", router);

    const res = await app.request("/logo", { headers: { host: "test.vertexcover.io" } });
    expect(res.status).toBe(404);
  });
});
