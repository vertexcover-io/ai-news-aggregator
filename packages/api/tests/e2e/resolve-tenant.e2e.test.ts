/**
 * P5 integration: host→tenant resolution middleware against the real DB.
 *
 * REQ-020: app-host requests use the SESSION tenant, never Host.
 * REQ-021: `<slug>.<root>` resolves the tenant by slug; unknown slug → 404.
 * REQ-022: configured custom domain maps to tenant 0 (AGENTLOOP).
 * REQ-023: a changed slug 301-redirects old host → new host (tenants repo
 *          updateSlug records previous_slug in the tenants schema; the
 *          tenant-slug service validates against the shared P1 constants).
 * EDGE-002: old links/emails (path + query) survive the redirect.
 * EDGE-013: unknown Host (typo subdomain / bare apex) → generic not-found,
 *           leaking nothing.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { like } from "drizzle-orm";
import { getDb, tenants } from "@newsletter/shared/db";
import type { TenantRow } from "@newsletter/shared/db";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createResolveTenant } from "@api/middleware/resolve-tenant.js";
import { loadDomainConfig, type DomainConfig } from "@api/config/domains.js";
import { changeTenantSlug, SlugChangeError } from "@api/services/tenant-slug.js";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";

const db = getDb();
const tenantsRepo = createTenantsRepo(db);

const SESSION_SECRET = "p5-test-session-secret-32-bytes-min!";
const STAMP = Date.now().toString(36);
const SLUG_PREFIX = `p5x${STAMP}`;

const ROOT = "p5-root.test";
const APP_HOST = `app.${ROOT}`;
const CUSTOM_DOMAIN = "news.p5-custom.test";

const slugA = `${SLUG_PREFIX}a`;
const slugZero = `${SLUG_PREFIX}zero`;
const slugCOld = `${SLUG_PREFIX}cold`;
const slugCNew = `${SLUG_PREFIX}cnew`;

let tenantA: TenantRow;
let tenantZero: TenantRow;
let tenantC: TenantRow;

/** Production-mode config: real Host classification, no dev overrides. */
const prodConfig: DomainConfig = loadDomainConfig({
  NODE_ENV: "production",
  ROOT_DOMAIN: ROOT,
  CUSTOM_DOMAIN_MAP: `${CUSTOM_DOMAIN}=${slugZero}`,
});

/** Dev-mode config: X-Tenant-Slug header + *.lvh.me enabled. */
const devConfig: DomainConfig = loadDomainConfig({
  ROOT_DOMAIN: ROOT,
  CUSTOM_DOMAIN_MAP: `${CUSTOM_DOMAIN}=${slugZero}`,
});

function buildProbeApp(cfg: DomainConfig): Hono {
  const app = new Hono();
  app.use(
    "/api/*",
    createResolveTenant({ config: cfg, getTenantsRepo: () => tenantsRepo }),
  );
  app.get("/api/probe", (c) =>
    c.json({
      publicTenant: c.get("publicTenant") ?? null,
      appHost: c.get("appHost") ?? null,
    }),
  );
  app.get("/api/admin/probe", requireAuth(SESSION_SECRET), (c) =>
    c.json({
      tenantCtx: c.get("tenantCtx"),
      publicTenant: c.get("publicTenant") ?? null,
      appHost: c.get("appHost") ?? null,
    }),
  );
  return app;
}

function probe(
  app: Hono,
  host: string,
  path = "/api/probe",
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(`http://${host}${path}`, {
    headers: { host, ...headers },
  });
}

function sessionCookie(tenantId: string): string {
  const token = issueToken(
    { userId: randomUUID(), tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

async function cleanup(): Promise<void> {
  await db.delete(tenants).where(like(tenants.slug, `${SLUG_PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  tenantA = await tenantsRepo.create({
    slug: slugA,
    name: "P5 Tenant A",
    status: "active",
  });
  tenantZero = await tenantsRepo.create({
    slug: slugZero,
    name: "P5 Tenant Zero (AGENTLOOP stand-in)",
    status: "active",
  });
  tenantC = await tenantsRepo.create({
    slug: slugCOld,
    name: "P5 Tenant C (renamed)",
    status: "active",
  });
});

afterAll(cleanup);

describe("resolve-tenant middleware (P5 e2e)", () => {
  it("test_REQ_020_app_host_uses_session_tenant", async () => {
    const app = buildProbeApp(prodConfig);

    // App host + session: admin scope is the SESSION tenant; no Host tenant.
    const adminRes = await probe(app, APP_HOST, "/api/admin/probe", {
      cookie: sessionCookie(tenantA.id),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as {
      tenantCtx: { tenantId: string };
      publicTenant: unknown;
    };
    expect(adminBody.tenantCtx.tenantId).toBe(tenantA.id);
    expect(adminBody.publicTenant).toBeNull();

    // App host never resolves a tenant from Host, even on public routes, and is
    // flagged `appHost` so public content routes 404 there (no cross-tenant leak).
    const publicRes = await probe(app, APP_HOST);
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as {
      publicTenant: unknown;
      appHost: unknown;
    };
    expect(publicBody.publicTenant).toBeNull();
    expect(publicBody.appHost).toBe(true);

    // Even on a slug host, the admin scope stays the session tenant.
    const crossRes = await probe(app, `${slugZero}.${ROOT}`, "/api/admin/probe", {
      cookie: sessionCookie(tenantA.id),
    });
    expect(crossRes.status).toBe(200);
    const crossBody = (await crossRes.json()) as {
      tenantCtx: { tenantId: string };
    };
    expect(crossBody.tenantCtx.tenantId).toBe(tenantA.id);
  });

  it("test_REQ_021_slug_host_resolves_tenant_unknown_notfound", async () => {
    const app = buildProbeApp(prodConfig);

    // Known slug resolves that tenant for the public site.
    const known = await probe(app, `${slugA}.${ROOT}`);
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({
      publicTenant: { tenantId: tenantA.id, slug: slugA, featureCanon: false },
      appHost: null,
    });

    // Unknown slug → generic not-found (no tenant existence leak).
    const unknown = await probe(app, `${SLUG_PREFIX}nosuch.${ROOT}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });

    // Dev overrides: X-Tenant-Slug header and *.lvh.me target a tenant locally.
    const devApp = buildProbeApp(devConfig);
    const viaHeader = await probe(devApp, "localhost:3000", "/api/probe", {
      "x-tenant-slug": slugA,
    });
    expect(viaHeader.status).toBe(200);
    expect(await viaHeader.json()).toEqual({
      publicTenant: { tenantId: tenantA.id, slug: slugA, featureCanon: false },
      appHost: null,
    });

    const viaLvh = await probe(devApp, `${slugA}.lvh.me:5173`);
    expect(viaLvh.status).toBe(200);
    expect(await viaLvh.json()).toEqual({
      publicTenant: { tenantId: tenantA.id, slug: slugA, featureCanon: false },
      appHost: null,
    });

    // The header override is dev-only: production config ignores it.
    const prodHeader = await probe(app, APP_HOST, "/api/probe", {
      "x-tenant-slug": slugA,
    });
    expect(prodHeader.status).toBe(200);
    expect(((await prodHeader.json()) as { publicTenant: unknown }).publicTenant).toBeNull();
  });

  it("test_REQ_022_custom_domain_maps_tenant0", async () => {
    const app = buildProbeApp(prodConfig);
    const res = await probe(app, CUSTOM_DOMAIN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      publicTenant: {
        tenantId: tenantZero.id,
        slug: slugZero,
        featureCanon: false,
      },
      appHost: null,
    });
  });

  it("test_REQ_023_old_slug_301_redirects (tenants repo + tenant-slug service record previous_slug in the tenants schema)", async () => {
    // The tenant-slug service rejects invalid/reserved/taken slugs using the
    // shared P1 constants before anything is persisted.
    await expect(
      changeTenantSlug({ tenantsRepo }, tenantC.id, "Bad_Slug!"),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      changeTenantSlug({ tenantsRepo }, tenantC.id, "admin"),
    ).rejects.toMatchObject({ code: "reserved" });
    await expect(
      changeTenantSlug({ tenantsRepo }, tenantC.id, slugA),
    ).rejects.toMatchObject({ code: "taken" });
    await expect(
      changeTenantSlug({ tenantsRepo }, randomUUID(), slugCNew),
    ).rejects.toBeInstanceOf(SlugChangeError);

    // Valid change: tenants repo updateSlug records the previous slug
    // (tenants schema previous_slug column).
    const updated = await changeTenantSlug({ tenantsRepo }, tenantC.id, slugCNew);
    expect(updated.slug).toBe(slugCNew);
    expect(updated.previousSlug).toBe(slugCOld);

    // Old slug host now 301-redirects to the new slug host.
    const app = buildProbeApp(prodConfig);
    const res = await probe(app, `${slugCOld}.${ROOT}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      `http://${slugCNew}.${ROOT}/api/probe`,
    );
  });

  it("test_EDGE_002_slug_change_old_links_resolve", async () => {
    const app = buildProbeApp(prodConfig);

    // In-flight link with path + query survives the redirect intact…
    const res = await probe(
      app,
      `${slugCOld}.${ROOT}:8443`,
      "/api/probe?utm=email&issue=42",
    );
    expect(res.status).toBe(301);
    const location = res.headers.get("location");
    expect(location).toBe(
      `http://${slugCNew}.${ROOT}:8443/api/probe?utm=email&issue=42`,
    );

    // …and the redirect target serves the same tenant.
    const followed = await probe(app, `${slugCNew}.${ROOT}`);
    expect(followed.status).toBe(200);
    expect(await followed.json()).toEqual({
      publicTenant: { tenantId: tenantC.id, slug: slugCNew, featureCanon: false },
      appHost: null,
    });
  });

  it("test_EDGE_013_unknown_host_notfound_no_leak", async () => {
    const app = buildProbeApp(prodConfig);
    const unknownHosts = [
      ROOT, // bare apex
      `typo-${STAMP}.${ROOT}`, // typo subdomain
      `deep.nested.${ROOT}`, // multi-label — never a slug
      "totally-unrelated.example", // foreign domain, not in the custom map
    ];
    const bodies: unknown[] = [];
    for (const host of unknownHosts) {
      const res = await probe(app, host);
      expect(res.status).toBe(404);
      bodies.push(await res.json());
    }
    // Identical generic body for every unknown class — nothing distinguishes
    // "tenant missing" from "domain unknown", so nothing leaks.
    for (const body of bodies) {
      expect(body).toEqual({ error: "not_found" });
    }
  });
});
