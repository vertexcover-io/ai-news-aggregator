import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import {
  createPublicTenantMiddleware,
  getTenantId,
  resolveHost,
  type PublicTenantEnv,
} from "@api/middleware/tenant-host.js";
import type { TenantRecord, TenantsRepo } from "@api/repositories/tenants.js";

const OPTS = {
  appHost: "app.lvh.me",
  rootDomain: "lvh.me",
  tenant0Domain: "news.vertexcover.io",
};

describe("resolveHost", () => {
  it.each([
    // REQ-020: app host wins
    ["app.lvh.me", { kind: "app" }],
    ["app.lvh.me:3000", { kind: "app" }],
    ["APP.LVH.ME", { kind: "app" }],
    // REQ-022: tenant-0 custom domain
    ["news.vertexcover.io", { kind: "tenant0" }],
    ["news.vertexcover.io:443", { kind: "tenant0" }],
    // REQ-021: slug subdomains
    ["acme.lvh.me", { kind: "slug", slug: "acme" }],
    ["Acme.LVH.me:5173", { kind: "slug", slug: "acme" }],
    ["my-news.lvh.me", { kind: "slug", slug: "my-news" }],
    // EDGE-013: bare apex, nested, foreign, garbage
    ["lvh.me", { kind: "unknown" }],
    ["a.b.lvh.me", { kind: "unknown" }],
    ["example.com", { kind: "unknown" }],
    ["", { kind: "unknown" }],
  ] as const)("resolves %s", (host, expected) => {
    expect(resolveHost(host, OPTS)).toEqual(expected);
  });

  it("treats undefined host as unknown", () => {
    expect(resolveHost(undefined, OPTS)).toEqual({ kind: "unknown" });
  });

  it("does not map tenant0 when tenant0Domain is unset", () => {
    expect(
      resolveHost("news.vertexcover.io", { ...OPTS, tenant0Domain: undefined }),
    ).toEqual({ kind: "unknown" });
  });
});

function tenant(partial: Partial<TenantRecord>): TenantRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "acme",
    previousSlug: null,
    name: "Acme",
    status: "active",
    createdAt: new Date(),
    ...partial,
  };
}

function buildApp(
  repo: Partial<TenantsRepo>,
  allowDevHeader = false,
): Hono<PublicTenantEnv> {
  const app = new Hono<PublicTenantEnv>();
  app.use(
    "*",
    createPublicTenantMiddleware({
      getTenantsRepo: () => ({
        findBySlug: () => Promise.resolve(null),
        findByPreviousSlug: () => Promise.resolve(null),
        ...repo,
      }),
      ...OPTS,
      allowDevHeader,
    }),
  );
  app.get("/things", (c) => c.json({ tenantId: getTenantId(c) }));
  return app;
}

describe("createPublicTenantMiddleware", () => {
  it("REQ-021: known active slug resolves the tenant", async () => {
    const app = buildApp({
      findBySlug: (slug) =>
        Promise.resolve(slug === "acme" ? tenant({}) : null),
    });
    const res = await app.request("http://acme.lvh.me/things", {
      headers: { host: "acme.lvh.me" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("REQ-021/EDGE-013: unknown slug returns 404 without tenant info", async () => {
    const app = buildApp({});
    const res = await app.request("http://nope.lvh.me/things", {
      headers: { host: "nope.lvh.me" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("REQ-031: pending_setup tenant serves not-found", async () => {
    const app = buildApp({
      findBySlug: () => Promise.resolve(tenant({ status: "pending_setup" })),
    });
    const res = await app.request("http://acme.lvh.me/things", {
      headers: { host: "acme.lvh.me" },
    });
    expect(res.status).toBe(404);
  });

  it("REQ-022: tenant-0 custom domain resolves TENANT_ZERO_ID", async () => {
    const app = buildApp({});
    const res = await app.request("http://news.vertexcover.io/things", {
      headers: { host: "news.vertexcover.io" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: TENANT_ZERO_ID });
  });

  it("REQ-020: app host is not a public tenant surface", async () => {
    const app = buildApp({});
    const res = await app.request("http://app.lvh.me/things", {
      headers: { host: "app.lvh.me" },
    });
    expect(res.status).toBe(404);
  });

  it("EDGE-013: bare apex returns 404", async () => {
    const app = buildApp({});
    const res = await app.request("http://lvh.me/things", {
      headers: { host: "lvh.me" },
    });
    expect(res.status).toBe(404);
  });

  it("REQ-023: renamed slug 301-redirects preserving path, query, and port", async () => {
    const app = buildApp({
      findBySlug: () => Promise.resolve(null),
      findByPreviousSlug: (slug) =>
        Promise.resolve(slug === "oldname" ? tenant({ slug: "newname" }) : null),
    });
    const res = await app.request("http://oldname.lvh.me:3000/things?a=1&b=2", {
      headers: { host: "oldname.lvh.me:3000" },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "http://newname.lvh.me:3000/things?a=1&b=2",
    );
  });

  it("previous slug pointing at a pending tenant still 404s", async () => {
    const app = buildApp({
      findByPreviousSlug: () =>
        Promise.resolve(tenant({ slug: "newname", status: "pending_setup" })),
    });
    const res = await app.request("http://oldname.lvh.me/things", {
      headers: { host: "oldname.lvh.me" },
    });
    expect(res.status).toBe(404);
  });

  it("dev header overrides host when allowDevHeader", async () => {
    const app = buildApp(
      {
        findBySlug: (slug) =>
          Promise.resolve(slug === "acme" ? tenant({}) : null),
      },
      true,
    );
    const res = await app.request("http://localhost:3000/things", {
      headers: { host: "localhost:3000", "x-tenant-slug": "acme" },
    });
    expect(res.status).toBe(200);
  });

  it("dev header is ignored when allowDevHeader is false", async () => {
    const app = buildApp(
      {
        findBySlug: (slug) =>
          Promise.resolve(slug === "acme" ? tenant({}) : null),
      },
      false,
    );
    const res = await app.request("http://localhost:3000/things", {
      headers: { host: "localhost:3000", "x-tenant-slug": "acme" },
    });
    expect(res.status).toBe(404);
  });
});

describe("getTenantId", () => {
  it("prefers auth tenant over public tenant and throws when neither set", () => {
    const fakeCtx = (vars: Record<string, unknown>) =>
      ({
        get: (k: string) => vars[k],
      }) as unknown as Parameters<typeof getTenantId>[0];
    expect(
      getTenantId(
        fakeCtx({
          auth: { tenantId: "auth-tid" },
          publicTenant: { tenantId: "pub-tid", slug: "x" },
        }),
      ),
    ).toBe("auth-tid");
    expect(
      getTenantId(fakeCtx({ publicTenant: { tenantId: "pub-tid", slug: "x" } })),
    ).toBe("pub-tid");
    expect(() => getTenantId(fakeCtx({}))).toThrow(/tenant/i);
  });
});
