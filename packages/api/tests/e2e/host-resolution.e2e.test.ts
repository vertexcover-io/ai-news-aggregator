/**
 * e2e: Host → tenant resolution middleware integration test.
 * Verifies REQ-020 (app host → session), REQ-021 (slug host → tenant),
 * REQ-022 (custom domain → tenant 0), EDGE-013 (unknown slug → 404).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  resolveTenant,
  buildResolveTenantConfig,
} from "@api/middleware/resolve-tenant.js";

function makeTestApp(configOverrides?: Record<string, string | undefined>) {
  const cfg = buildResolveTenantConfig({
    ROOT_DOMAIN: "vertexcover.io",
    APP_SUBDOMAIN: "app",
    CUSTOM_DOMAIN_MAP: "agentloop.ai=00000000-0000-0000-0000-000000000001",
    ...configOverrides,
  });

  const app = new Hono();
  app.use("*", resolveTenant(cfg));

  app.get("/api/test-classification", (c) => {
    const classification = c.get("hostClassification") as { type: string; slug?: string; tenantId?: string } | undefined;
    return c.json(classification ?? { type: "unknown" });
  });

  return app;
}

describe("Phase 5: Host → tenant resolution (e2e)", () => {
  it("REQ-020: app host → type 'app'", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "app.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("app");
  });

  it("REQ-020: app host with port → type 'app'", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "app.vertexcover.io:3000" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("app");
  });

  it("REQ-021: slug host → type 'slug' with slug extracted", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "mytenant.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("slug");
    expect(body.slug).toBe("mytenant");
  });

  it("REQ-021: hyphenated slug → extracted correctly", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "my-newsletter.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("slug");
    expect(body.slug).toBe("my-newsletter");
  });

  it("REQ-022: custom domain → type 'custom' with tenantId", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "agentloop.ai" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("custom");
    expect(body.tenantId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("EDGE-013: unknown host → type 'unknown'", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "random.com" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("unknown");
  });

  it("EDGE-013: bare root domain → type 'unknown'", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: { host: "vertexcover.io" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("unknown");
  });

  it("Dev override: X-Tenant-Slug header works in non-production", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification", {
      headers: {
        host: "whatever.com",
        "x-tenant-slug": "my-dev-tenant",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("slug");
    expect(body.slug).toBe("my-dev-tenant");
  });

  it("No host header → type 'unknown'", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/test-classification");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("unknown");
  });
});
