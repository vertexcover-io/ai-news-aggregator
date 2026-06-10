import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type {
  OnboardingProgressRow,
  TenantContext,
  TenantRow,
  SourceRow,
} from "@newsletter/shared";
import { createOnboardingRouter } from "../onboarding.js";
import type {
  OnboardingRouterDeps,
} from "../onboarding.js";
import type { OnboardingProgressRepo } from "@api/repositories/onboarding-progress.js";
import type { SourcesRepo } from "@api/repositories/sources.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { TenantVariables } from "@api/middleware/types.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_ID,
    slug: "acme",
    previousSlug: null,
    status: "pending_setup",
    name: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    logoVersion: 0,
    customDomain: null,
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
    builtPageEnabled: false,
    notificationEmail: null,
    slackWebhook: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const unused = (): never => {
  throw new Error("not used");
};

function makeOnboardingRepo(
  initial: OnboardingProgressRow | null = null,
): OnboardingProgressRepo {
  const state = { row: initial };
  return {
    get: (): Promise<OnboardingProgressRow | null> => Promise.resolve(state.row),
    upsert: (furthestStep, data): Promise<OnboardingProgressRow> => {
      state.row = { tenantId: TENANT_ID, furthestStep, data, updatedAt: new Date() };
      return Promise.resolve(state.row);
    },
  };
}

function makeSourcesRepo(rows: SourceRow[] = []): SourcesRepo {
  return {
    listForTenant: (): Promise<SourceRow[]> => Promise.resolve(rows),
    listEnabled: (): Promise<SourceRow[]> =>
      Promise.resolve(rows.filter((r) => r.enabled)),
    add: unused,
    remove: (): Promise<void> => Promise.resolve(),
    setEnabled: unused,
  };
}

function makeTenantsRepo(tenant: TenantRow, available = true): TenantsRepo {
  const state = { tenant };
  return {
    create: unused,
    getById: (id): Promise<TenantRow | null> =>
      Promise.resolve(id === state.tenant.id ? state.tenant : null),
    getBySlug: (): Promise<TenantRow | null> => Promise.resolve(null),
    getByCustomDomain: (): Promise<TenantRow | null> => Promise.resolve(null),
    getByPreviousSlug: (): Promise<TenantRow | null> => Promise.resolve(null),
    list: () => Promise.resolve([]),
    updateBranding: (_id, update): Promise<TenantRow> => {
      state.tenant = { ...state.tenant, ...update } as TenantRow;
      return Promise.resolve(state.tenant);
    },
    updateStatus: (_id, status): Promise<TenantRow> => {
      state.tenant = { ...state.tenant, status };
      return Promise.resolve(state.tenant);
    },
    updateSlug: unused,
    isSlugAvailable: (): Promise<boolean> => Promise.resolve(available),
  };
}

function makeSettingsRepo(): UserSettingsRepo {
  return {
    get: (): Promise<null> => Promise.resolve(null),
    upsert: unused,
    getForTenant: (): Promise<null> => Promise.resolve(null),
    upsertForTenant: unused,
  };
}

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn<() => Promise<never>>(),
    removeJobScheduler: vi.fn<() => Promise<never>>(),
  };
}

function makeApp(deps: Partial<OnboardingRouterDeps> = {}) {
  const ctx: TenantContext = { tenantId: TENANT_ID, role: "tenant_admin" };
  const onboardingRepo = deps.getOnboardingRepo?.(ctx) ?? makeOnboardingRepo();
  const sourcesRepo = deps.getSourcesRepo?.(ctx) ?? makeSourcesRepo();
  const tenantsRepo = deps.getTenantsRepo?.() ?? makeTenantsRepo(makeTenant());
  const settingsRepo = deps.getSettingsRepo?.() ?? makeSettingsRepo();
  const processingQueue = makeQueue();
  const collectorHealthQueue = makeQueue();

  const router = createOnboardingRouter({
    getOnboardingRepo: () => onboardingRepo,
    getSourcesRepo: () => sourcesRepo,
    getSettingsRepo: () => settingsRepo,
    getTenantsRepo: () => tenantsRepo,
    processingQueue,
    collectorHealthQueue,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });

  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", ctx);
    await next();
  });
  app.route("/api/onboarding", router);
  return { app, processingQueue, collectorHealthQueue };
}

describe("GET /api/onboarding/progress", () => {
  it("returns furthestStep 0 and empty data when none saved", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/progress");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ furthestStep: 0, data: {} });
  });

  it("resumes saved progress", async () => {
    const repo = makeOnboardingRepo({
      tenantId: TENANT_ID,
      furthestStep: 3,
      data: { name: "Acme" },
      updatedAt: new Date(),
    });
    const { app } = makeApp({ getOnboardingRepo: () => repo });
    const res = await app.request("/api/onboarding/progress");
    expect(await res.json()).toEqual({ furthestStep: 3, data: { name: "Acme" } });
  });
});

describe("PATCH /api/onboarding/step", () => {
  it("merges data and keeps the furthest step monotonic", async () => {
    const repo = makeOnboardingRepo({
      tenantId: TENANT_ID,
      furthestStep: 4,
      data: { name: "Acme" },
      updatedAt: new Date(),
    });
    const { app } = makeApp({ getOnboardingRepo: () => repo });
    const res = await app.request("/api/onboarding/step", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ furthestStep: 2, data: { headline: "Hi" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      furthestStep: 4,
      data: { name: "Acme", headline: "Hi" },
    });
  });

  it("rejects malformed body", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/step", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ furthestStep: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/onboarding/slug-check (REQ-033)", () => {
  it("reports available for a free valid slug", async () => {
    const { app } = makeApp({
      getTenantsRepo: () => makeTenantsRepo(makeTenant(), true),
    });
    const res = await app.request("/api/onboarding/slug-check?slug=cool-news");
    expect(await res.json()).toEqual({ status: "available" });
  });

  it("reports taken for a used slug", async () => {
    const { app } = makeApp({
      getTenantsRepo: () => makeTenantsRepo(makeTenant(), false),
    });
    const res = await app.request("/api/onboarding/slug-check?slug=cool-news");
    expect(await res.json()).toEqual({ status: "taken" });
  });

  it("reports invalid for reserved/bad-shape slug", async () => {
    const { app } = makeApp();
    const reserved = await app.request("/api/onboarding/slug-check?slug=admin");
    expect(await reserved.json()).toEqual({ status: "invalid" });
    const bad = await app.request("/api/onboarding/slug-check?slug=A_B");
    expect(await bad.json()).toEqual({ status: "invalid" });
  });
});

describe("POST /api/onboarding/generate-prompts (REQ-026)", () => {
  it("returns non-empty ranking and shortlist prompts derived from the blurb", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "Weekly robotics digest" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rankingPrompt: string;
      shortlistPrompt: string;
    };
    expect(body.rankingPrompt).toContain("Weekly robotics digest");
    expect(body.shortlistPrompt).toContain("Weekly robotics digest");
    expect(body.rankingPrompt.length).toBeGreaterThan(50);
    expect(body.shortlistPrompt.length).toBeGreaterThan(50);
  });

  it("rejects an empty blurb", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/onboarding/discover-sources (REQ-027/F51)", () => {
  it("returns candidates that are not auto-added", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/discover-sources");
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates.length).toBeGreaterThan(0);
  });

  it("filters by query substring", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/discover-sources?q=hacker");
    const body = (await res.json()) as { candidates: { name: string }[] };
    expect(body.candidates.every((c) => c.name.toLowerCase().includes("hacker"))).toBe(
      true,
    );
    expect(body.candidates.length).toBe(1);
  });
});

describe("POST /api/onboarding/logo (REQ-039)", () => {
  const onePx =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("accepts a valid small png and bumps the logo version", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", data: onePx }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logoVersion: number };
    expect(body.logoVersion).toBe(1);
  });

  it("rejects an unsupported type, leaving existing logo untouched", async () => {
    const tenants = makeTenantsRepo(
      makeTenant({ logoContentType: "image/png", logoVersion: 7 }),
    );
    const { app } = makeApp({ getTenantsRepo: () => tenants });
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/gif", data: onePx }),
    });
    expect(res.status).toBe(415);
    expect((await tenants.getById(TENANT_ID))?.logoVersion).toBe(7);
  });

  it("rejects an oversize logo", async () => {
    const big = Buffer.alloc(512 * 1024 + 1).toString("base64");
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", data: big }),
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/onboarding/activate (REQ-035/038)", () => {
  function completeData() {
    return {
      name: "Acme",
      slug: "acme",
      headline: "Daily AI",
      rankingPrompt: "rank",
      shortlistPrompt: "short",
      schedule: { pipelineTime: "08:00" },
    };
  }

  it("blocks activation listing missing steps when incomplete", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/onboarding/activate", { method: "POST" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe("incomplete");
    expect(body.missing).toContain("sources");
    expect(body.missing).toContain("name");
  });

  it("activates the tenant and reconciles schedulers when complete", async () => {
    const tenants = makeTenantsRepo(makeTenant());
    const onboarding = makeOnboardingRepo({
      tenantId: TENANT_ID,
      furthestStep: 6,
      data: completeData(),
      updatedAt: new Date(),
    });
    const source: SourceRow = {
      id: "s1",
      tenantId: TENANT_ID,
      type: "hn",
      config: {},
      enabled: true,
      health: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const settings: UserSettingsRepo = {
      ...makeSettingsRepo(),
      getForTenant: () =>
        Promise.resolve({
          scheduleEnabled: true,
          pipelineTime: "08:00",
          emailTime: "08:30",
          linkedinTime: "08:30",
          twitterTime: "08:30",
          scheduleTimezone: "UTC",
          emailEnabled: false,
          linkedinEnabled: false,
          twitterPostEnabled: false,
        } as never),
    };
    const { app, processingQueue, collectorHealthQueue } = makeApp({
      getTenantsRepo: () => tenants,
      getOnboardingRepo: () => onboarding,
      getSourcesRepo: () => makeSourcesRepo([source]),
      getSettingsRepo: () => settings,
    });
    const res = await app.request("/api/onboarding/activate", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "active" });
    expect((await tenants.getById(TENANT_ID))?.status).toBe("active");
    expect(processingQueue.upsertJobScheduler).toHaveBeenCalled();
    expect(collectorHealthQueue.upsertJobScheduler).toHaveBeenCalled();
  });
});
