/**
 * P11 integration: resumable onboarding + activation gate against the real
 * DB (LLM/Tavily endpoints are NOT exercised here — they are injected fakes
 * at the router seam; see tests/unit/onboarding-route.test.ts).
 *
 * REQ-030 — PATCH persists partial progress; GET resumes it.
 * REQ-032 — every wizard field round-trips.
 * REQ-031 — pending_setup: public host 404s, no scheduler entry exists.
 * REQ-035 — activation: tenant active + profile/settings applied + per-tenant
 *           scheduler entries + public host serves the site.
 * REQ-038 — incomplete activation blocked with the missing-step list.
 * EDGE-001 — slug uniqueness race → loser told "taken" and stays pending.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq, like } from "drizzle-orm";
import {
  getDb,
  sources,
  tenants,
  userSettings,
} from "@newsletter/shared/db";
import type {
  OnboardingStateResponse,
  ActivateBlockedResponse,
} from "@newsletter/shared/types/tenant";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createSourcesRepo } from "@api/repositories/sources.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createOnboardingRouter } from "@api/routes/onboarding.js";
import { createBrandingRouter } from "@api/routes/branding.js";
import { createResolveTenant } from "@api/middleware/resolve-tenant.js";
import { loadDomainConfig } from "@api/config/domains.js";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";

const db = getDb();
const tenantsRepo = createTenantsRepo(db);

const STAMP = Date.now().toString(36);
const ROOT = "p11-root.test";
const SESSION_SECRET = "p11-test-session-secret-32-bytes-minimum!!";
const CHOSEN_SLUG = `p11w${STAMP}`;
const RIVAL_SLUG = `p11r${STAMP}`;

let tenantId = "";
let rivalTenantId = "";

interface FakeQueue {
  upserts: Map<string, { name: string; data: unknown }>;
  upsertJobScheduler: (
    key: string,
    repeat: unknown,
    template: { name: string; data: unknown },
  ) => Promise<void>;
  removeJobScheduler: (key: string) => Promise<void>;
}

function makeFakeQueue(): FakeQueue {
  const upserts = new Map<string, { name: string; data: unknown }>();
  return {
    upserts,
    upsertJobScheduler: (key, _repeat, template) => {
      upserts.set(key, template);
      return Promise.resolve();
    },
    removeJobScheduler: (key) => {
      upserts.delete(key);
      return Promise.resolve();
    },
  };
}

const processingQueue = makeFakeQueue();
const collectorHealthQueue = makeFakeQueue();

function buildApp(): Hono {
  const app = new Hono();
  app.use(
    "/api/*",
    createResolveTenant({
      config: loadDomainConfig({ ROOT_DOMAIN: ROOT, NODE_ENV: "production" }),
      getTenantsRepo: () => tenantsRepo,
    }),
  );
  app.route(
    "/api/branding",
    createBrandingRouter({ getTenantsRepo: () => tenantsRepo }),
  );
  const gate = requireAuth(SESSION_SECRET);
  const gated = new Hono();
  gated.use("*", gate);
  gated.route(
    "/",
    createOnboardingRouter({
      getTenantsRepo: () => tenantsRepo,
      getSourcesRepo: (scope) => createSourcesRepo(db, scope),
      getSettingsRepo: (scope) => createUserSettingsRepo(db, scope),
      processingQueue,
      collectorHealthQueue,
      generatePrompts: () =>
        Promise.resolve({ rankingPrompt: "fake", shortlistPrompt: "fake" }),
      discoverSources: () => Promise.resolve([]),
    }),
  );
  app.route("/api/onboarding", gated);
  return app;
}

function sessionCookie(): string {
  return `${COOKIE_NAME}=${issueToken(
    { userId: "11111111-1111-4111-8111-111111111111", tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  )}`;
}

beforeAll(async () => {
  const created = await tenantsRepo.create({
    slug: `pending-p11${STAMP}`,
    name: "P11 Signup Name",
    status: "pending_setup",
  });
  tenantId = created.id;
  const rival = await tenantsRepo.create({
    slug: RIVAL_SLUG,
    name: "P11 Rival",
    status: "active",
  });
  rivalTenantId = rival.id;
});

afterAll(async () => {
  // Targeted cleanup — only rows this spec created.
  const ids = [tenantId, rivalTenantId].filter((id) => id !== "");
  for (const id of ids) {
    await db.delete(sources).where(eq(sources.tenantId, id));
    await db.delete(userSettings).where(eq(userSettings.tenantId, id));
  }
  await db.delete(tenants).where(like(tenants.slug, `p11%${STAMP}`));
  await db.delete(tenants).where(like(tenants.slug, `pending-p11${STAMP}`));
});

describe("test_REQ_030_wizard_progress_resumes / test_REQ_032_wizard_fields_persist", () => {
  it("PATCH persists partial progress and GET restores it", async () => {
    const app = buildApp();
    const patch1 = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { cookie: sessionCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "slug",
        completedSteps: ["name"],
        data: { name: "The Inference" },
      }),
    });
    expect(patch1.status).toBe(200);

    // Second partial save merges — earlier fields survive (REQ-030).
    const patch2 = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { cookie: sessionCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "homepage",
        completedSteps: ["name", "slug"],
        data: {
          slug: CHOSEN_SLUG,
          headline: "The daily read for inference.",
          topicStrip: "Serving · Quantization",
          subtagline: "Just the runtime.",
          blurb: "Practical LLM inference.",
          rankingPrompt: "Rank by usefulness.",
          shortlistPrompt: "Keep inference items.",
          pipelineTime: "06:00",
          emailTime: "07:30",
          timezone: "UTC",
        },
      }),
    });
    expect(patch2.status).toBe(200);

    const res = await app.request("/api/onboarding", {
      headers: { cookie: sessionCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingStateResponse;
    expect(body.status).toBe("pending_setup");
    expect(body.state?.currentStep).toBe("homepage");
    expect(body.state?.completedSteps).toEqual(["name", "slug"]);
    // REQ-032: every field persisted, including the merged-from-patch-1 name.
    expect(body.state?.data).toEqual({
      name: "The Inference",
      slug: CHOSEN_SLUG,
      headline: "The daily read for inference.",
      topicStrip: "Serving · Quantization",
      subtagline: "Just the runtime.",
      blurb: "Practical LLM inference.",
      rankingPrompt: "Rank by usefulness.",
      shortlistPrompt: "Keep inference items.",
      pipelineTime: "06:00",
      emailTime: "07:30",
      timezone: "UTC",
    });
  });
});

describe("test_REQ_031_pending_setup_inactive_no_schedule", () => {
  it("the pending tenant's would-be public host 404s and no scheduler entry exists", async () => {
    const app = buildApp();
    // Even the CURRENT (placeholder) slug serves nothing while pending.
    const placeholderHost = `pending-p11${STAMP}.${ROOT}`;
    const res = await app.request("/api/branding", {
      headers: { host: placeholderHost },
    });
    expect(res.status).toBe(404);

    // No per-tenant scheduler entry has been created (REQ-031).
    expect(processingQueue.upserts.has(`pipeline-run:${tenantId}`)).toBe(false);
    expect(collectorHealthQueue.upserts.size).toBe(0);
  });
});

describe("test_REQ_038_activation_blocked_lists_missing", () => {
  it("a tenant missing sources (and only sources) is blocked with exactly that step", async () => {
    const app = buildApp();
    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
      headers: { cookie: sessionCookie() },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ActivateBlockedResponse;
    expect(body.error).toBe("incomplete");
    expect(body.missing).toEqual(["sources"]);

    const tenant = await tenantsRepo.findById(tenantId);
    expect(tenant?.status).toBe("pending_setup");
  });
});

describe("test_EDGE_001_slug_race_unique_loser_taken", () => {
  it("slug-available reports a held slug as taken; activate with it → slug_taken", async () => {
    const app = buildApp();
    const check = await app.request(
      `/api/onboarding/slug-available?slug=${RIVAL_SLUG}`,
      { headers: { cookie: sessionCookie() } },
    );
    expect(await check.json()).toEqual({ slug: RIVAL_SLUG, status: "taken" });

    // Give the tenant a source so ONLY the slug conflict can block.
    const scopedSources = createSourcesRepo(db, {
      tenantId,
      role: "tenant_admin",
    });
    await scopedSources.create({
      type: "hn",
      config: { kind: "hn", sinceDays: 1 },
    });

    await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { cookie: sessionCookie(), "content-type": "application/json" },
      body: JSON.stringify({ data: { slug: RIVAL_SLUG } }),
    });
    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
      headers: { cookie: sessionCookie() },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ActivateBlockedResponse;
    expect(body.error).toBe("slug_taken");
    expect(body.missing).toEqual(["slug"]);
    const tenant = await tenantsRepo.findById(tenantId);
    expect(tenant?.status).toBe("pending_setup");
  });
});

describe("test_REQ_035_activate_when_required_complete", () => {
  it("activates: tenant active with applied profile, settings row, schedulers, live public host", async () => {
    const app = buildApp();
    // Repick the free slug after the EDGE-001 loss.
    await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { cookie: sessionCookie(), "content-type": "application/json" },
      body: JSON.stringify({ data: { slug: CHOSEN_SLUG } }),
    });

    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
      headers: { cookie: sessionCookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slug: CHOSEN_SLUG });

    const tenant = await tenantsRepo.findById(tenantId);
    expect(tenant?.status).toBe("active");
    expect(tenant?.slug).toBe(CHOSEN_SLUG);
    expect(tenant?.name).toBe("The Inference");
    expect(tenant?.headline).toBe("The daily read for inference.");
    expect(tenant?.topicStrip).toBe("Serving · Quantization");
    expect(tenant?.subtagline).toBe("Just the runtime.");

    // Per-tenant settings row with the wizard's prompts + schedule.
    const settings = await createUserSettingsRepo(db, {
      tenantId,
      role: "tenant_admin",
    }).get();
    expect(settings?.rankingPrompt).toBe("Rank by usefulness.");
    expect(settings?.shortlistPrompt).toBe("Keep inference items.");
    expect(settings?.pipelineTime).toBe("06:00");
    expect(settings?.emailTime).toBe("07:30");
    expect(settings?.scheduleEnabled).toBe(true);

    // Per-tenant scheduler entries exist and carry the tenant id (REQ-035).
    const entry = processingQueue.upserts.get(`pipeline-run:${tenantId}`);
    expect(entry?.name).toBe("pipeline-run");
    expect(entry?.data).toEqual({ tenantId });
    expect(
      collectorHealthQueue.upserts.has(`collector-health:${tenantId}`),
    ).toBe(true);

    // Public site live on the chosen slug host (REQ-035).
    const live = await app.request("/api/branding", {
      headers: { host: `${CHOSEN_SLUG}.${ROOT}` },
    });
    expect(live.status).toBe(200);
    expect(((await live.json()) as { name: string }).name).toBe(
      "The Inference",
    );
  });
});
