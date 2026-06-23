/**
 * P7 integration: per-tenant branding + Host-scoped public reads.
 *
 * REQ-043: tenant logo served from Postgres bytes with content-type +
 *          long-lived cache headers + ETag (and 304 on If-None-Match).
 * REQ-044: an archive owned by tenant A requested on tenant B's host →
 *          not-found (public archive routes are fenced by the Host-resolved
 *          tenant).
 * REQ-040 (API side): /api/branding returns each Host's own branding.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { inArray, like } from "drizzle-orm";
import { getDb, runArchives, tenants } from "@newsletter/shared/db";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { createResolveTenant } from "@api/middleware/resolve-tenant.js";
import { loadDomainConfig } from "@api/config/domains.js";
import { createPublicArchivesRouter } from "@api/routes/archives.js";
import { createPublicHomeRouter } from "@api/routes/home.js";
import { createBrandingRouter } from "@api/routes/branding.js";

const db = getDb();
const tenantsRepo = createTenantsRepo(db);

const STAMP = Date.now().toString(36);
const SLUG_A = `p7a${STAMP}`;
const SLUG_B = `p7b${STAMP}`;
const ROOT = "p7-root.test";
const HOST_A = `${SLUG_A}.${ROOT}`;
const HOST_B = `${SLUG_B}.${ROOT}`;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

let tenantAId = "";
let archiveAId = "";

function buildApp(): Hono {
  const app = new Hono();
  app.use(
    "/api/*",
    createResolveTenant({
      config: loadDomainConfig({ ROOT_DOMAIN: ROOT, NODE_ENV: "production" }),
      getTenantsRepo: () => tenantsRepo,
    }),
  );
  // Mirror index.ts wiring: default-style deps that build repos per request
  // with whatever scope the route derives from the Host-resolved tenant.
  app.route(
    "/api/archives",
    createPublicArchivesRouter({
      getRawItemsRepo: (scope) => createRawItemsRepo(db, scope),
      getArchiveRepo: (scope) => createRunArchivesRepo(db, scope),
      getSettingsRepo: (scope) => createUserSettingsRepo(db, scope),
    }),
  );
  app.route(
    "/api/home",
    createPublicHomeRouter({
      getArchiveRepo: (scope) => createRunArchivesRepo(db, scope),
      getRawItemsRepo: (scope) => createRawItemsRepo(db, scope),
      getMustReadRepo: (scope) => createMustReadRepo(db, scope),
    }),
  );
  app.route(
    "/api/branding",
    createBrandingRouter({ getTenantsRepo: () => tenantsRepo }),
  );
  return app;
}

async function cleanup(): Promise<void> {
  if (archiveAId) {
    await db.delete(runArchives).where(inArray(runArchives.id, [archiveAId]));
  }
  await db.delete(tenants).where(like(tenants.slug, `p7%${STAMP}`));
}

beforeAll(async () => {
  await cleanup();
  const a = await db
    .insert(tenants)
    .values({
      slug: SLUG_A,
      name: "P7 Tenant A",
      status: "active",
      headline: "Tenant A headline.",
      topicStrip: "ALPHA · BETA",
      subtagline: "Tenant A subtag.",
      logoBytes: PNG_BYTES,
      logoContentType: "image/png",
      featureCanon: true,
    })
    .returning({ id: tenants.id });
  tenantAId = a[0].id;
  await db
    .insert(tenants)
    .values({ slug: SLUG_B, name: "P7 Tenant B", status: "active" });

  archiveAId = randomUUID();
  await db.insert(runArchives).values({
    id: archiveAId,
    tenantId: tenantAId,
    status: "completed",
    rankedItems: [],
    topN: 0,
    reviewed: true,
    completedAt: new Date(),
    startedAt: new Date(Date.now() - 60_000),
    sourceTypes: ["hn"],
  });
});

afterAll(cleanup);

describe("GET /api/branding (Host-resolved)", () => {
  it("returns each host's own branding payload", async () => {
    const app = buildApp();
    const resA = await app.request("/api/branding", { headers: { host: HOST_A } });
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as TenantBranding;
    expect(bodyA.name).toBe("P7 Tenant A");
    expect(bodyA.flags.canon).toBe(true);
    expect(bodyA.isTenantZero).toBe(false);
    expect(bodyA.logoUrl).toMatch(/^\/api\/branding\/logo\?v=/);

    const resB = await app.request("/api/branding", { headers: { host: HOST_B } });
    const bodyB = (await resB.json()) as TenantBranding;
    expect(bodyB.name).toBe("P7 Tenant B");
    expect(bodyB.flags.canon).toBe(false);
    expect(bodyB.logoUrl).toBeNull();
  });
});

describe("test_REQ_043_logo_served_with_content_type_and_cache", () => {
  it("serves Postgres-stored bytes with content-type, immutable cache-control and ETag; 304 on revalidation", async () => {
    const app = buildApp();
    const res = await app.request("/api/branding/logo", { headers: { host: HOST_A } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    const revalidated = await app.request("/api/branding/logo", {
      headers: { host: HOST_A, "if-none-match": etag ?? "" },
    });
    expect(revalidated.status).toBe(304);
  });

  it("404s on a host whose tenant has no logo", async () => {
    const app = buildApp();
    const res = await app.request("/api/branding/logo", { headers: { host: HOST_B } });
    expect(res.status).toBe(404);
  });
});

describe("test_REQ_044_cross_host_archive_notfound", () => {
  it("serves tenant A's archive on tenant A's host", async () => {
    const app = buildApp();
    const res = await app.request(`/api/archives/${archiveAId}`, {
      headers: { host: HOST_A },
    });
    expect(res.status).toBe(200);
  });

  it("responds not-found for tenant A's archive on tenant B's host", async () => {
    const app = buildApp();
    const res = await app.request(`/api/archives/${archiveAId}`, {
      headers: { host: HOST_B },
    });
    expect(res.status).toBe(404);
  });

  it("scopes the public archive listing and home payload to the Host tenant", async () => {
    const app = buildApp();
    const listB = await app.request("/api/archives", { headers: { host: HOST_B } });
    expect(listB.status).toBe(200);
    const bodyB = (await listB.json()) as { archives: { runId: string }[] };
    expect(bodyB.archives.some((a) => a.runId === archiveAId)).toBe(false);

    const homeB = await app.request("/api/home", { headers: { host: HOST_B } });
    expect(homeB.status).toBe(200);
    const homeBodyB = (await homeB.json()) as {
      todaysIssue: { runId: string } | null;
      recentIssues: { runId: string }[];
    };
    expect(homeBodyB.todaysIssue?.runId).not.toBe(archiveAId);
    expect(homeBodyB.recentIssues.some((a) => a.runId === archiveAId)).toBe(false);

    const listA = await app.request("/api/archives", { headers: { host: HOST_A } });
    const bodyA = (await listA.json()) as { archives: { runId: string }[] };
    expect(bodyA.archives.some((a) => a.runId === archiveAId)).toBe(true);
  });
});
