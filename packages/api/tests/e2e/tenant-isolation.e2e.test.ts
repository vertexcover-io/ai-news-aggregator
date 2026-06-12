/**
 * Phase 3 e2e: tenant isolation (REQ-011, REQ-012, REQ-013, REQ-020, REQ-021,
 * REQ-044, REQ-120, EDGE-013).
 *
 * Seeds two throwaway tenants (A and B) with parallel data — users, settings,
 * archives, raw items, subscribers, must-read rows — and proves no repository
 * or route path returns the other tenant's rows:
 *  - repo seam: cross-tenant ids resolve to null / empty (REQ-012)
 *  - admin routes scoped by the session tenant: listings disjoint, cross-tenant
 *    GET by id is 404 (REQ-011, REQ-013)
 *  - public routes scoped by Host: per-slug data, cross-host archive 404
 *    (REQ-021, REQ-044), unknown host 404 with no leak (EDGE-013), dev
 *    X-Tenant-Slug override
 *  - subscribe is host-scoped: new subscriber lands in the host's tenant
 *  - session wins over host when both are present (REQ-011, REQ-020)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { getDb } from "@newsletter/shared/db";
import { createRedisConnection } from "@newsletter/shared";
import { requireUser } from "@api/auth/middleware.js";
import { makeSessionCookie } from "@api-tests/helpers/auth.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import {
  createSubscribersRepo,
  createSubscriberTenantLookup,
} from "@api/repositories/subscribers.js";
import { createFeedbackEventsRepo } from "@api/repositories/feedback-events.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import {
  createNotificationSettingsRepo,
  createUserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createSourcesRepo } from "@api/repositories/sources.js";
import {
  createPublicArchivesRouter,
  createAdminArchivesRouter,
} from "@api/routes/archives.js";
import { createPublicMustReadRouter } from "@api/routes/must-read.js";
import { createAdminMustReadRouter } from "@api/routes/admin-must-read.js";
import { createPublicHomeRouter } from "@api/routes/home.js";
import { createSettingsRouter } from "@api/routes/settings.js";
import { createTenantFeaturesRepo } from "@api/repositories/tenant-features.js";
import { createRunsRouter } from "@api/routes/runs.js";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import {
  createPublicTenantMiddleware,
  type PublicTenantEnv,
} from "@api/middleware/tenant-host.js";
import { createSendingDomainsRepo } from "@api/repositories/sending-domains.js";
import { createSendingDomainRouter } from "@api/routes/sending-domains.js";
import { createTenantConfigRouter } from "@api/routes/tenant-config.js";
import { createBrandingRouter } from "@api/routes/branding.js";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { createImpersonationEventsRepo } from "@api/repositories/impersonation-events.js";
import { createOnboardingRouter } from "@api/routes/onboarding.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const redis = createRedisConnection();

const SESSION_SECRET = "tenant-isolation-e2e-secret-at-least-32-bytes";
const SLUGS = { a: "isolation-e2e-a", b: "isolation-e2e-b" } as const;
const ROOT_DOMAIN = "lvh.me";
const APP_HOST = `app.${ROOT_DOMAIN}`;
const URL_MARK = "https://tenant-isolation.example.com/";
const EMAIL_DOMAIN = "tenant-isolation.example.com";
const RAW_ITEM_MARK = "tenant-isolation-e2e";

const tenantIds = { a: "", b: "" };
const archiveIds = { a: randomUUID(), b: randomUUID() };
const rawItemIds = { a: 0, b: 0 };

async function cleanup(): Promise<void> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})`,
  );
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    for (const table of [
      "must_read_entries",
      "subscribers",
      "run_archives",
      "raw_items",
      "user_settings",
      "sending_domains",
      "users",
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id IN (${idList})`,
      );
    }
    await db.execute(sql`DELETE FROM tenants WHERE id IN (${idList})`);
  }
}

beforeAll(async () => {
  await cleanup();

  for (const key of ["a", "b"] as const) {
    const inserted = await db.execute<{ id: string }>(
      sql`INSERT INTO tenants (slug, name, status)
          VALUES (${SLUGS[key]}, ${`Isolation Tenant ${key.toUpperCase()}`}, 'active')
          RETURNING id`,
    );
    const tenantId = inserted[0].id;
    tenantIds[key] = tenantId;

    await db.execute(
      sql`INSERT INTO users (tenant_id, email, password_hash, role)
          VALUES (${tenantId}::uuid, ${`admin-${key}@${EMAIL_DOMAIN}`},
                  'x', 'tenant_admin')`,
    );

    await db.execute(
      sql`INSERT INTO user_settings
            (tenant_id, top_n, shortlist_size, ranking_prompt, shortlist_prompt,
             pipeline_time, email_time, linkedin_time, twitter_time,
             schedule_timezone)
          VALUES (${tenantId}::uuid, 5, 20, 'rank',
                  ${`isolation prompt tenant ${key}`},
                  '09:00', '10:00', '10:15', '10:30', 'UTC')`,
    );

    await db.execute(
      sql`INSERT INTO run_archives
            (id, tenant_id, status, ranked_items, top_n, reviewed, is_dry_run,
             completed_at, started_at, source_types, digest_headline)
          VALUES (${archiveIds[key]}::uuid, ${tenantId}::uuid, 'completed',
                  '[]'::jsonb, 5, true, false, now(), now(), '["hn"]'::jsonb,
                  ${`Tenant ${key.toUpperCase()} isolation digest`})`,
    );

    const rawItem = await db.execute<{ id: number }>(
      sql`INSERT INTO raw_items (tenant_id, source_type, external_id, title, url)
          VALUES (${tenantId}::uuid, 'hn', ${`${RAW_ITEM_MARK}-${key}`},
                  ${`Isolation item ${key}`}, ${`${URL_MARK}item-${key}`})
          RETURNING id`,
    );
    rawItemIds[key] = rawItem[0].id;

    await createMustReadRepo(db, tenantId).create({
      url: `${URL_MARK}${key}`,
      title: `Isolation canon ${key}`,
      author: null,
      year: null,
      annotation: "isolation test",
    });

    await createSubscribersRepo(db, tenantId).create({
      email: `reader-${key}@${EMAIL_DOMAIN}`,
      status: "confirmed",
    });
  }
});

afterAll(async () => {
  await cleanup();
  await redis.quit();
});

function cookieFor(tenantId: string): string {
  return makeSessionCookie(SESSION_SECRET, { tid: tenantId });
}

function makeQueue() {
  return {
    add: vi.fn(() => Promise.resolve({ id: "job" })),
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

function buildAdminApp(): Hono {
  const app = new Hono();
  app.use("*", requireUser(SESSION_SECRET));
  app.route(
    "/api/admin/archives",
    createAdminArchivesRouter({
      getRawItemsRepo: (tenantId) => createRawItemsRepo(db, tenantId),
      getArchiveRepo: (tenantId) => createRunArchivesRepo(db, tenantId),
    }),
  );
  app.route(
    "/api/admin/must-read",
    createAdminMustReadRouter({
      getRepo: (tenantId) => createMustReadRepo(db, tenantId),
    }),
  );
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: (tenantId) => createUserSettingsRepo(db, tenantId),
      getNotificationSettingsRepo: (tenantId) =>
        createNotificationSettingsRepo(db, tenantId),
      cipher: getCredentialCipher(),
      getSourcesRepo: (tenantId) => createSourcesRepo(db, tenantId),
      processingQueue: makeQueue() as never,
      collectorHealthQueue: makeQueue() as never,
      isTenantActive: () => Promise.resolve(true),
      tenantFeatures: createTenantFeaturesRepo(db),
    }),
  );
  app.route(
    "/api/runs",
    createRunsRouter({
      redis,
      processingQueue: makeQueue() as never,
      getRawItemsRepo: (tenantId) => createRawItemsRepo(db, tenantId),
      getSettingsRepo: (tenantId) => createUserSettingsRepo(db, tenantId),
      getArchiveRepo: (tenantId) => createRunArchivesRepo(db, tenantId),
    }),
  );
  return app;
}

function buildPublicApp(allowDevHeader = false): Hono<PublicTenantEnv> {
  const app = new Hono<PublicTenantEnv>();
  app.use(
    "*",
    createPublicTenantMiddleware({
      getTenantsRepo: () => createTenantsRepo(db),
      appHost: APP_HOST,
      rootDomain: ROOT_DOMAIN,
      tenant0Domain: undefined,
      allowDevHeader,
    }),
  );
  app.route(
    "/api/archives",
    createPublicArchivesRouter({
      getRawItemsRepo: (tenantId) => createRawItemsRepo(db, tenantId),
      getArchiveRepo: (tenantId) => createRunArchivesRepo(db, tenantId),
    }),
  );
  app.route(
    "/api/must-read",
    createPublicMustReadRouter({
      getMustReadRepo: (tenantId) => createMustReadRepo(db, tenantId),
    }),
  );
  app.route(
    "/api/home",
    createPublicHomeRouter({
      getArchiveRepo: (tenantId) => createRunArchivesRepo(db, tenantId),
      getRawItemsRepo: (tenantId) => createRawItemsRepo(db, tenantId),
      getMustReadRepo: (tenantId) => createMustReadRepo(db, tenantId),
    }),
  );
  app.route(
    "/api",
    createSubscribeRouter({
      getSubscribersRepo: (tenantId) => createSubscribersRepo(db, tenantId),
      subscriberLookup: createSubscriberTenantLookup(db),
      getFeedbackEventsRepo: (tenantId) => createFeedbackEventsRepo(db, tenantId),
      feedbackCampaign: "tenant-isolation-e2e",
      sessionSecret: SESSION_SECRET,
      baseUrl: "http://api.test",
      webBaseUrl: "http://web.test",
      sendConfirmationEmail: () => Promise.resolve(),
      sendNewsletterToSubscriber: () => Promise.resolve(),
      getMostRecentReviewedArchiveId: () => Promise.resolve(null),
      slackNotifier: {
        notifyNewsletterSent: () => Promise.resolve(),
        notifyReviewPending: () => Promise.resolve(),
        notifyReviewWarning: () => Promise.resolve(),
        notifyPublishFailed: () => Promise.resolve(),
        notifyPublishUnavailable: () => Promise.resolve(),
        notifySourceDistribution: () => Promise.resolve(),
        notifyEmailDelivery: () => Promise.resolve(),
        notifyLinkedinPosted: () => Promise.resolve(),
        notifyTwitterPosted: () => Promise.resolve(),
        notifySubscriberConfirmed: () => Promise.resolve(),
        notifySubscriberRemoved: () => Promise.resolve(),
        notifyFeedbackReceived: () => Promise.resolve(),
      },
    }),
  );
  return app;
}

function hostRequest(
  app: Hono<PublicTenantEnv> | Hono,
  host: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(`http://${host}${path}`, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), host },
  });
}

describe("repository seam isolation (REQ-012, REQ-126)", () => {
  it("findById on another tenant's archive returns null", async () => {
    const repoA = createRunArchivesRepo(db, tenantIds.a);
    const repoB = createRunArchivesRepo(db, tenantIds.b);

    expect(await repoA.findById(archiveIds.a)).not.toBeNull();
    expect(await repoA.findById(archiveIds.b)).toBeNull();
    expect(await repoB.findById(archiveIds.b)).not.toBeNull();
    expect(await repoB.findById(archiveIds.a)).toBeNull();
  });

  it("raw-items findByIds never returns another tenant's rows", async () => {
    const repoA = createRawItemsRepo(db, tenantIds.a);
    expect(await repoA.findByIds([rawItemIds.b])).toEqual([]);
    const own = await repoA.findByIds([rawItemIds.a]);
    expect(own.map((r) => r.id)).toEqual([rawItemIds.a]);
  });

  it("must-read listings are disjoint per tenant", async () => {
    const urlsA = (await createMustReadRepo(db, tenantIds.a).listPublic()).map(
      (r) => r.url,
    );
    const urlsB = (await createMustReadRepo(db, tenantIds.b).listPublic()).map(
      (r) => r.url,
    );
    expect(urlsA).toContain(`${URL_MARK}a`);
    expect(urlsA).not.toContain(`${URL_MARK}b`);
    expect(urlsB).toContain(`${URL_MARK}b`);
    expect(urlsB).not.toContain(`${URL_MARK}a`);
  });

  it("subscribers are invisible across tenants", async () => {
    const repoA = createSubscribersRepo(db, tenantIds.a);
    const repoB = createSubscribersRepo(db, tenantIds.b);
    const a = await repoA.findByEmail(`reader-a@${EMAIL_DOMAIN}`);
    expect(a).not.toBeNull();
    expect(a?.tenantId).toBe(tenantIds.a);
    if (!a) throw new Error("unreachable");
    expect(await repoB.findByEmail(a.email)).toBeNull();
    expect(await repoB.findById(a.id)).toBeNull();
  });
});

describe("admin routes scope to the session tenant (REQ-011, REQ-013)", () => {
  const app = buildAdminApp();

  it("runs list with tenant-A session contains A's run and never B's", async () => {
    const res = await app.request("/api/runs", {
      headers: { cookie: cookieFor(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { runId: string }[] };
    const ids = body.runs.map((r) => r.runId);
    expect(ids).toContain(archiveIds.a);
    expect(ids).not.toContain(archiveIds.b);
  });

  it("admin archive GET of a B-owned id with an A session is 404", async () => {
    const own = await app.request(`/api/admin/archives/${archiveIds.a}`, {
      headers: { cookie: cookieFor(tenantIds.a) },
    });
    expect(own.status).toBe(200);

    const cross = await app.request(`/api/admin/archives/${archiveIds.b}`, {
      headers: { cookie: cookieFor(tenantIds.a) },
    });
    expect(cross.status).toBe(404);
  });

  it("admin must-read list with an A session only has A's rows", async () => {
    const res = await app.request("/api/admin/must-read", {
      headers: { cookie: cookieFor(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { url: string }[];
    const marked = rows.map((r) => r.url).filter((u) => u.startsWith(URL_MARK));
    expect(marked).toEqual([`${URL_MARK}a`]);
  });

  it("settings GET returns the session tenant's settings row", async () => {
    for (const key of ["a", "b"] as const) {
      const res = await app.request("/api/settings", {
        headers: { cookie: cookieFor(tenantIds[key]) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { shortlistPrompt: string };
      expect(body.shortlistPrompt).toBe(`isolation prompt tenant ${key}`);
    }
  });
});

describe("host-scoped public routes (REQ-021, REQ-044, REQ-120)", () => {
  const app = buildPublicApp();
  const hosts = {
    a: `${SLUGS.a}.${ROOT_DOMAIN}`,
    b: `${SLUGS.b}.${ROOT_DOMAIN}`,
  };

  it("archives listing on each host only contains that tenant's archives", async () => {
    for (const key of ["a", "b"] as const) {
      const other = key === "a" ? "b" : "a";
      const res = await hostRequest(app, hosts[key], "/api/archives");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { archives: { runId: string }[] };
      const ids = body.archives.map((r) => r.runId);
      expect(ids).toContain(archiveIds[key]);
      expect(ids).not.toContain(archiveIds[other]);
    }
  });

  it("B's archive id requested on A's host is 404 (REQ-044)", async () => {
    const own = await hostRequest(app, hosts.a, `/api/archives/${archiveIds.a}`);
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { digestHeadline: string | null };
    expect(ownBody.digestHeadline).toBe("Tenant A isolation digest");

    const cross = await hostRequest(app, hosts.a, `/api/archives/${archiveIds.b}`);
    expect(cross.status).toBe(404);
  });

  it("home payload on A's host never references B's data", async () => {
    const res = await hostRequest(app, hosts.a, "/api/home");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(archiveIds.a);
    expect(text).not.toContain(archiveIds.b);
    expect(text).not.toContain("Tenant B isolation digest");
  });

  it("must-read listing on B's host only contains B's rows", async () => {
    const res = await hostRequest(app, hosts.b, "/api/must-read");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string }[];
    const urls = body.map((r) => r.url).filter((u) => u.startsWith(URL_MARK));
    expect(urls).toEqual([`${URL_MARK}b`]);
  });

  it("unknown slug host 404s without leaking data (EDGE-013)", async () => {
    const host = `no-such-tenant.${ROOT_DOMAIN}`;
    const res = await hostRequest(app, host, `/api/archives/${archiveIds.a}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("X-Tenant-Slug dev header overrides the host when enabled", async () => {
    const devApp = buildPublicApp(true);
    const res = await devApp.request(
      `http://${APP_HOST}/api/archives/${archiveIds.b}`,
      { headers: { host: APP_HOST, "x-tenant-slug": SLUGS.b } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digestHeadline: string | null };
    expect(body.digestHeadline).toBe("Tenant B isolation digest");

    // The same request without the dev header stays the app host: no tenant.
    const withoutHeader = await hostRequest(
      app,
      APP_HOST,
      `/api/archives/${archiveIds.b}`,
    );
    expect(withoutHeader.status).toBe(404);
  });
});

describe("subscribe is host-scoped", () => {
  it("POST /api/subscribe on A's host creates a tenant-A subscriber", async () => {
    const app = buildPublicApp();
    const email = `new-subscriber@${EMAIL_DOMAIN}`;
    const res = await hostRequest(app, `${SLUGS.a}.${ROOT_DOMAIN}`, "/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);

    const created = await createSubscribersRepo(db, tenantIds.a).findByEmail(email);
    expect(created).not.toBeNull();
    expect(created?.tenantId).toBe(tenantIds.a);
    expect(
      await createSubscribersRepo(db, tenantIds.b).findByEmail(email),
    ).toBeNull();
  });
});

describe("session-vs-host precedence (REQ-011, REQ-020)", () => {
  function buildHybridApp(): Hono<PublicTenantEnv> {
    const app = new Hono<PublicTenantEnv>();
    app.use(
      "*",
      createPublicTenantMiddleware({
        getTenantsRepo: () => createTenantsRepo(db),
        appHost: APP_HOST,
        rootDomain: ROOT_DOMAIN,
        tenant0Domain: undefined,
        allowDevHeader: false,
      }),
    );
    app.use("*", requireUser(SESSION_SECRET));
    app.route(
      "/api/settings",
      createSettingsRouter({
        getSettingsRepo: (tenantId) => createUserSettingsRepo(db, tenantId),
        getNotificationSettingsRepo: (tenantId) =>
          createNotificationSettingsRepo(db, tenantId),
        cipher: getCredentialCipher(),
        getSourcesRepo: (tenantId) => createSourcesRepo(db, tenantId),
        processingQueue: makeQueue() as never,
        collectorHealthQueue: makeQueue() as never,
        isTenantActive: () => Promise.resolve(true),
        tenantFeatures: createTenantFeaturesRepo(db),
      }),
    );
    return app;
  }

  it("a tenant-A session on B's host scopes to the session tenant", async () => {
    const app = buildHybridApp();
    const res = await hostRequest(app, `${SLUGS.b}.${ROOT_DOMAIN}`, "/api/settings", {
      headers: { cookie: cookieFor(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shortlistPrompt: string };
    expect(body.shortlistPrompt).toBe("isolation prompt tenant a");
  });

  it("the same request without a session is rejected by the gate", async () => {
    const app = buildHybridApp();
    const res = await hostRequest(app, `${SLUGS.b}.${ROOT_DOMAIN}`, "/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("Phase 7-10 surfaces: sending domains, tenant config, branding", () => {
  const domains = {
    a: "mail.isolation-a.example.com",
    b: "mail.isolation-b.example.com",
  } as const;

  beforeAll(async () => {
    for (const key of ["a", "b"] as const) {
      await createSendingDomainsRepo(db, tenantIds[key]).upsert({
        domain: domains[key],
        resendDomainId: `resend-${key}`,
        status: key === "a" ? "pending" : "verified",
        dnsRecords: null,
        failureReason: null,
      });
      await db.execute(
        sql`UPDATE tenants
            SET headline = ${`Isolation headline ${key.toUpperCase()}`}
            WHERE id = ${tenantIds[key]}::uuid`,
      );
    }
  });

  function buildSendingDomainApp(): Hono {
    const app = new Hono();
    app.use("*", requireUser(SESSION_SECRET));
    app.route(
      "/api/admin/sending-domain",
      createSendingDomainRouter({
        getSendingDomainsRepo: (tenantId) =>
          createSendingDomainsRepo(db, tenantId),
        resendDomains: null,
      }),
    );
    return app;
  }

  it("sending-domain status with an A session never returns B's domain", async () => {
    const app = buildSendingDomainApp();
    for (const key of ["a", "b"] as const) {
      const other = key === "a" ? "b" : "a";
      const res = await app.request("/api/admin/sending-domain", {
        headers: { cookie: cookieFor(tenantIds[key]) },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(domains[key]);
      expect(text).not.toContain(domains[other]);
      // resendDomainId is server-side only — never serialized (NF6).
      expect(text).not.toContain(`resend-${key}`);
    }
  });

  it("tenant-config on A's host never returns B's branding", async () => {
    const app = new Hono<PublicTenantEnv>();
    app.use(
      "*",
      createPublicTenantMiddleware({
        getTenantsRepo: () => createTenantsRepo(db),
        appHost: APP_HOST,
        rootDomain: ROOT_DOMAIN,
        tenant0Domain: undefined,
        allowDevHeader: false,
      }),
    );
    app.route(
      "/api/public/tenant-config",
      createTenantConfigRouter({ tenantsRepo: createTenantsRepo(db) }),
    );

    for (const key of ["a", "b"] as const) {
      const other = key === "a" ? "b" : "a";
      const res = await hostRequest(
        app,
        `${SLUGS[key]}.${ROOT_DOMAIN}`,
        "/api/public/tenant-config",
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; headline: string };
      expect(body.name).toBe(`Isolation Tenant ${key.toUpperCase()}`);
      expect(body.headline).toBe(`Isolation headline ${key.toUpperCase()}`);
      expect(body.headline).not.toContain(
        `Isolation headline ${other.toUpperCase()}`,
      );
    }
  });

  it("branding PUT with an A session mutates A only — B stays untouched", async () => {
    const app = new Hono();
    app.use("*", requireUser(SESSION_SECRET));
    app.route(
      "/api/admin/branding",
      createBrandingRouter({ tenantsRepo: createTenantsRepo(db) }),
    );

    const res = await app.request("/api/admin/branding", {
      method: "PUT",
      headers: {
        cookie: cookieFor(tenantIds.a),
        "content-type": "application/json",
      },
      body: JSON.stringify({ headline: "Rewritten by tenant A" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headline: string };
    expect(body.headline).toBe("Rewritten by tenant A");

    const tenantsRepo = createTenantsRepo(db);
    const brandingA = await tenantsRepo.getBranding(tenantIds.a);
    const brandingB = await tenantsRepo.getBranding(tenantIds.b);
    expect(brandingA?.headline).toBe("Rewritten by tenant A");
    expect(brandingB?.headline).toBe("Isolation headline B");
  });
});

describe("impersonation sessions scope to the impersonated tenant (REQ-101, EDGE-008)", () => {
  const adminApp = buildAdminApp();

  function impersonationCookie(tenantId: string): string {
    return makeSessionCookie(SESSION_SECRET, {
      role: "super_admin",
      tid: null,
      imp: tenantId,
    });
  }

  function buildSuperAdminApp(): Hono {
    const app = new Hono();
    app.route(
      "/api/super-admin",
      createSuperAdminRouter({
        sessionSecret: SESSION_SECRET,
        getTenantsRepo: () => createTenantsRepo(db),
        getImpersonationEventsRepo: () => createImpersonationEventsRepo(db),
      }),
    );
    return app;
  }

  it("admin runs listing under imp=A only contains A's runs", async () => {
    const res = await adminApp.request("/api/runs", {
      headers: { cookie: impersonationCookie(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { runId: string }[] };
    const ids = body.runs.map((r) => r.runId);
    expect(ids).toContain(archiveIds.a);
    expect(ids).not.toContain(archiveIds.b);
  });

  it("admin archive GET of B's id under imp=A is 404; A's id is 200", async () => {
    const own = await adminApp.request(`/api/admin/archives/${archiveIds.a}`, {
      headers: { cookie: impersonationCookie(tenantIds.a) },
    });
    expect(own.status).toBe(200);

    const cross = await adminApp.request(`/api/admin/archives/${archiveIds.b}`, {
      headers: { cookie: impersonationCookie(tenantIds.a) },
    });
    expect(cross.status).toBe(404);
  });

  it("settings GET under imp=A returns A's settings row, never B's", async () => {
    const res = await adminApp.request("/api/settings", {
      headers: { cookie: impersonationCookie(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shortlistPrompt: string };
    expect(body.shortlistPrompt).toBe("isolation prompt tenant a");
  });

  it("requireSuperAdmin still passes while impersonating (role survives imp)", async () => {
    const app = buildSuperAdminApp();
    const res = await app.request("/api/super-admin/tenants", {
      headers: { cookie: impersonationCookie(tenantIds.a) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: { id: string }[] };
    const ids = body.tenants.map((t) => t.id);
    expect(ids).toContain(tenantIds.a);
    expect(ids).toContain(tenantIds.b);
  });

  it("a tenant_admin session cannot escalate to super-admin routes (403)", async () => {
    const app = buildSuperAdminApp();
    for (const path of [
      "/api/super-admin/tenants",
      `/api/super-admin/impersonate/${tenantIds.b}`,
    ]) {
      const res = await app.request(path, {
        method: path.includes("impersonate") ? "POST" : "GET",
        headers: { cookie: cookieFor(tenantIds.a) },
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("onboarding routes operate strictly on the session tenant (REQ-030..033)", () => {
  function buildOnboardingApp(): Hono {
    const app = new Hono();
    app.use("*", requireUser(SESSION_SECRET));
    app.route(
      "/api/admin/onboarding",
      createOnboardingRouter({
        tenantsRepo: createTenantsRepo(db),
        getSettingsRepo: (tenantId) => createUserSettingsRepo(db, tenantId),
        getSourcesRepo: (tenantId) => createSourcesRepo(db, tenantId),
        promptGeneration: null,
        processingQueue: makeQueue() as never,
        collectorHealthQueue: makeQueue() as never,
      }),
    );
    return app;
  }

  it("GET /state returns the session tenant and nothing else", async () => {
    const app = buildOnboardingApp();
    for (const key of ["a", "b"] as const) {
      const res = await app.request("/api/admin/onboarding/state", {
        headers: { cookie: cookieFor(tenantIds[key]) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenant: { id: string } };
      expect(body.tenant.id).toBe(tenantIds[key]);
    }
  });

  it("a B session PATCH mutates only B — A's name and onboarding stay intact", async () => {
    const app = buildOnboardingApp();
    const res = await app.request("/api/admin/onboarding/state", {
      method: "PATCH",
      headers: {
        cookie: cookieFor(tenantIds.b),
        "content-type": "application/json",
      },
      body: JSON.stringify({ step: "name", data: { name: "Renamed by B" } }),
    });
    expect(res.status).toBe(200);

    const names = await db.execute<{ id: string; name: string; onboarding: unknown }>(
      sql`SELECT id, name, onboarding FROM tenants
          WHERE id IN (${tenantIds.a}::uuid, ${tenantIds.b}::uuid)`,
    );
    const byId = new Map(names.map((r) => [r.id, r]));
    expect(byId.get(tenantIds.b)?.name).toBe("Renamed by B");
    expect(byId.get(tenantIds.a)?.name).toBe("Isolation Tenant A");
    expect(byId.get(tenantIds.a)?.onboarding ?? null).toBeNull();
  });

  it("prompts PATCH from B never touches A's user_settings", async () => {
    const app = buildOnboardingApp();
    const res = await app.request("/api/admin/onboarding/state", {
      method: "PATCH",
      headers: {
        cookie: cookieFor(tenantIds.b),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        step: "prompts",
        data: { rankingPrompt: "B ranking", shortlistPrompt: "B shortlist" },
      }),
    });
    expect(res.status).toBe(200);

    const settingsA = await createUserSettingsRepo(db, tenantIds.a).get();
    const settingsB = await createUserSettingsRepo(db, tenantIds.b).get();
    expect(settingsB?.shortlistPrompt).toBe("B shortlist");
    expect(settingsA?.shortlistPrompt).toBe("isolation prompt tenant a");
  });
});
