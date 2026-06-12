import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { setTestTenant, TEST_TENANT_ID } from "../../helpers/tenant.js";
import {
  checkSlugFormat,
  createOnboardingRouter,
  ONBOARDING_STEPS,
  type OnboardingRouterDeps,
  type OnboardingTenantsRepo,
} from "@api/routes/onboarding.js";
import type {
  SetSlugResult,
  TenantOnboardingStateRecord,
} from "@api/repositories/tenants.js";
import type {
  UserSettingsRepo,
  UserSettingsUpsertInput,
} from "@api/repositories/user-settings.js";
import { PromptGenerationError } from "@api/services/prompt-generation.js";

function baseTenant(
  overrides: Partial<TenantOnboardingStateRecord> = {},
): TenantOnboardingStateRecord {
  return {
    id: TEST_TENANT_ID,
    slug: "pending-ab12cd34",
    name: "My Newsletter",
    status: "pending_setup",
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoVersion: 0,
    onboarding: null,
    ...overrides,
  };
}

function settingsRow(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "s1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "06:00",
    pipelineTime: "06:00",
    emailTime: "07:30",
    linkedinTime: "08:00",
    twitterTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "rank it",
    shortlistPrompt: "shortlist it",
    shortlistSize: 30,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Fixture {
  tenant: TenantOnboardingStateRecord;
  settings: UserSettings | null;
  enabledSources: number;
  takenSlugs: string[];
  setSlugResult?: SetSlugResult;
}

function buildFixture(fixture: Fixture) {
  const state = { ...fixture };
  const upserts: UserSettingsUpsertInput[] = [];

  const tenantsRepo: OnboardingTenantsRepo = {
    getOnboardingState: vi.fn(() => Promise.resolve({ ...state.tenant })),
    updateOnboarding: vi.fn((_id, onboarding) => {
      state.tenant = { ...state.tenant, onboarding };
      return Promise.resolve();
    }),
    updateBranding: vi.fn((_id, patch) => {
      state.tenant = { ...state.tenant, ...patch };
      return Promise.resolve(null);
    }),
    setSlug: vi.fn((_id, slug): Promise<SetSlugResult> => {
      if (state.setSlugResult) return Promise.resolve(state.setSlugResult);
      if (state.takenSlugs.includes(slug)) {
        return Promise.resolve({ ok: false, reason: "taken" });
      }
      const previousSlug = state.tenant.slug.startsWith("pending-")
        ? null
        : state.tenant.slug;
      state.tenant = { ...state.tenant, slug };
      return Promise.resolve({ ok: true, slug, previousSlug });
    }),
    isSlugTaken: vi.fn((slug: string) =>
      Promise.resolve(state.takenSlugs.includes(slug)),
    ),
    updateStatus: vi.fn((_id, status) => {
      state.tenant = { ...state.tenant, status };
      return Promise.resolve(null);
    }),
  };

  const settingsRepo: UserSettingsRepo = {
    get: vi.fn(() => Promise.resolve(state.settings)),
    upsert: vi.fn((input: UserSettingsUpsertInput) => {
      upserts.push(input);
      state.settings = settingsRow({
        ...input,
        scheduleTime: input.pipelineTime,
      });
      return Promise.resolve(state.settings);
    }),
  };

  const processingQueue = {
    upsertJobScheduler: vi.fn(() => Promise.resolve()),
    removeJobScheduler: vi.fn(() => Promise.resolve()),
  };
  const collectorHealthQueue = {
    upsertJobScheduler: vi.fn(() => Promise.resolve()),
    removeJobScheduler: vi.fn(() => Promise.resolve()),
  };

  const generate = vi.fn((description: string) =>
    Promise.resolve({
      rankingPrompt: `ranked for: ${description}`,
      shortlistPrompt: `shortlisted for: ${description}`,
    }),
  );

  const deps: OnboardingRouterDeps = {
    tenantsRepo,
    getSettingsRepo: () => settingsRepo,
    getSourcesRepo: () => ({
      listEnabled: vi.fn(() =>
        Promise.resolve(
          Array.from({ length: state.enabledSources }, (_, i) => ({
            id: `src-${String(i)}`,
          })) as never[],
        ),
      ),
    }),
    promptGeneration: { generate },
    processingQueue: processingQueue as never,
    collectorHealthQueue: collectorHealthQueue as never,
  };

  const app = new Hono();
  app.use("*", setTestTenant());
  app.route("/api/admin/onboarding", createOnboardingRouter(deps));

  return {
    app,
    state,
    upserts,
    tenantsRepo,
    settingsRepo,
    processingQueue,
    collectorHealthQueue,
    generate,
  };
}

function fixture(overrides: Partial<Fixture> = {}) {
  return buildFixture({
    tenant: baseTenant(),
    settings: null,
    enabledSources: 0,
    takenSlugs: [],
    ...overrides,
  });
}

function patchStep(app: Hono, body: unknown): Promise<Response> {
  return app.request("/api/admin/onboarding/state", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("checkSlugFormat", () => {
  it("accepts lowercase alnum + hyphens within 3-30 chars", () => {
    expect(checkSlugFormat("the-inference")).toBe("ok");
    expect(checkSlugFormat("abc")).toBe("ok");
    expect(checkSlugFormat("a2c")).toBe("ok");
  });

  it("rejects bad formats", () => {
    expect(checkSlugFormat("ab")).toBe("invalid");
    expect(checkSlugFormat("-abc")).toBe("invalid");
    expect(checkSlugFormat("abc-")).toBe("invalid");
    expect(checkSlugFormat("ABC")).toBe("invalid");
    expect(checkSlugFormat("a_c")).toBe("invalid");
    expect(checkSlugFormat("a".repeat(31))).toBe("invalid");
    expect(checkSlugFormat("")).toBe("invalid");
  });

  it("rejects reserved words and the pending- placeholder prefix (EDGE-003)", () => {
    expect(checkSlugFormat("admin")).toBe("reserved");
    expect(checkSlugFormat("app")).toBe("reserved");
    expect(checkSlugFormat("api")).toBe("reserved");
    expect(checkSlugFormat("pending-ab12cd34")).toBe("reserved");
  });
});

describe("GET /api/admin/onboarding/state", () => {
  it("returns tenant, default progress, null prompts/schedule, and source count", async () => {
    const f = fixture();
    const res = await f.app.request("/api/admin/onboarding/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tenant).toMatchObject({
      id: TEST_TENANT_ID,
      slug: "pending-ab12cd34",
      status: "pending_setup",
    });
    expect(body.onboarding).toEqual({ furthestStep: 0, completed: [] });
    expect(body.prompts).toBeNull();
    expect(body.schedule).toBeNull();
    expect(body.enabledSourceCount).toBe(0);
  });

  it("resumes from persisted progress and settings (REQ-030)", async () => {
    const f = fixture({
      tenant: baseTenant({
        slug: "daily-llm",
        headline: "Hello *world*",
        onboarding: { furthestStep: 4, completed: ["name", "slug", "homepage"] },
      }),
      settings: settingsRow({ rankingPrompt: "custom rank" }),
      enabledSources: 2,
    });
    const res = await f.app.request("/api/admin/onboarding/state");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.onboarding).toEqual({
      furthestStep: 4,
      completed: ["name", "slug", "homepage"],
    });
    expect(body.prompts).toMatchObject({ rankingPrompt: "custom rank" });
    expect(body.schedule).toMatchObject({
      pipelineTime: "06:00",
      emailTime: "07:30",
      timezone: "UTC",
    });
    expect(body.enabledSourceCount).toBe(2);
  });
});

describe("GET /api/admin/onboarding/slug-check", () => {
  const check = async (f: ReturnType<typeof fixture>, slug: string) => {
    const res = await f.app.request(
      `/api/admin/onboarding/slug-check?slug=${encodeURIComponent(slug)}`,
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { status: string }).status;
  };

  it("reports available / taken / invalid / reserved (REQ-033)", async () => {
    const f = fixture({ takenSlugs: ["taken-slug"] });
    expect(await check(f, "fresh-slug")).toBe("available");
    expect(await check(f, "taken-slug")).toBe("taken");
    expect(await check(f, "Bad_Slug")).toBe("invalid");
    expect(await check(f, "admin")).toBe("reserved");
  });

  it("excludes the asking tenant so its own slug stays available", async () => {
    const f = fixture({ tenant: baseTenant({ slug: "mine" }) });
    expect(await check(f, "mine")).toBe("available");
    expect(f.tenantsRepo.isSlugTaken).toHaveBeenCalledWith(
      "mine",
      TEST_TENANT_ID,
    );
  });
});

describe("PATCH /api/admin/onboarding/state", () => {
  it("saves the name and advances progress", async () => {
    const f = fixture();
    const res = await patchStep(f.app, {
      step: "name",
      data: { name: "The Inference" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(f.tenantsRepo.updateBranding).toHaveBeenCalledWith(TEST_TENANT_ID, {
      name: "The Inference",
    });
    expect(body.onboarding).toEqual({ furthestStep: 1, completed: ["name"] });
  });

  it("sets a valid slug and returns the updated tenant", async () => {
    const f = fixture();
    const res = await patchStep(f.app, {
      step: "slug",
      data: { slug: "the-inference" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { slug: string } };
    expect(body.tenant.slug).toBe("the-inference");
    expect(f.tenantsRepo.setSlug).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      "the-inference",
    );
  });

  it("rejects invalid and reserved slugs with 422 without writing", async () => {
    const f = fixture();
    expect(
      (await patchStep(f.app, { step: "slug", data: { slug: "-bad" } })).status,
    ).toBe(422);
    expect(
      (await patchStep(f.app, { step: "slug", data: { slug: "admin" } })).status,
    ).toBe(422);
    expect(f.tenantsRepo.setSlug).not.toHaveBeenCalled();
  });

  it("returns 409 taken when the unique constraint loses the race (EDGE-001)", async () => {
    const f = fixture({ setSlugResult: { ok: false, reason: "taken" } });
    const res = await patchStep(f.app, {
      step: "slug",
      data: { slug: "contested" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "slug_taken", status: "taken" });
  });

  it("saves homepage text to branding", async () => {
    const f = fixture();
    const res = await patchStep(f.app, {
      step: "homepage",
      data: {
        headline: "The daily read.",
        topicStrip: "Serving · Latency",
        subtagline: "Just the runtime.",
      },
    });
    expect(res.status).toBe(200);
    expect(f.tenantsRepo.updateBranding).toHaveBeenCalledWith(TEST_TENANT_ID, {
      headline: "The daily read.",
      topicStrip: "Serving · Latency",
      subtagline: "Just the runtime.",
    });
  });

  it("creates the settings row with defaults when prompts are saved first (REQ-036)", async () => {
    const f = fixture();
    const res = await patchStep(f.app, {
      step: "prompts",
      data: { rankingPrompt: "my rank", shortlistPrompt: "my shortlist" },
    });
    expect(res.status).toBe(200);
    expect(f.upserts).toHaveLength(1);
    expect(f.upserts[0]).toMatchObject({
      rankingPrompt: "my rank",
      shortlistPrompt: "my shortlist",
      scheduleEnabled: false,
      hnEnabled: false,
    });
  });

  it("merges the schedule into existing settings without clobbering prompts (REQ-032)", async () => {
    const f = fixture({ settings: settingsRow({ rankingPrompt: "keep me" }) });
    const res = await patchStep(f.app, {
      step: "schedule",
      data: { pipelineTime: "05:30", emailTime: "08:15", timezone: "Asia/Kolkata" },
    });
    expect(res.status).toBe(200);
    expect(f.upserts[0]).toMatchObject({
      pipelineTime: "05:30",
      emailTime: "08:15",
      scheduleTimezone: "Asia/Kolkata",
      scheduleEnabled: true,
      rankingPrompt: "keep me",
    });
  });

  it("marks progress for write-elsewhere steps (logo/channels/sources)", async () => {
    const f = fixture();
    for (const step of ["logo", "channels", "sources"] as const) {
      const res = await patchStep(f.app, { step });
      expect(res.status).toBe(200);
    }
    const completed = f.state.tenant.onboarding?.completed ?? [];
    expect(completed).toEqual(expect.arrayContaining(["logo", "channels", "sources"]));
    expect(f.upserts).toHaveLength(0);
  });

  it("never lowers furthestStep when revisiting an earlier step", async () => {
    const f = fixture({
      tenant: baseTenant({
        onboarding: { furthestStep: 6, completed: ["name", "slug"] },
      }),
    });
    await patchStep(f.app, { step: "name", data: { name: "Renamed" } });
    expect(f.state.tenant.onboarding?.furthestStep).toBe(6);
  });

  it("rejects malformed bodies with 400", async () => {
    const f = fixture();
    expect((await patchStep(f.app, { step: "bogus" })).status).toBe(400);
    expect((await patchStep(f.app, { step: "name", data: {} })).status).toBe(400);
    expect(
      (
        await patchStep(f.app, {
          step: "schedule",
          data: { pipelineTime: "25:00", emailTime: "07:00", timezone: "UTC" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("POST /api/admin/onboarding/generate-prompts", () => {
  it("returns generated candidates from the stubbed service (REQ-036)", async () => {
    const f = fixture();
    const res = await f.app.request("/api/admin/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Practical LLM inference for prod." }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rankingPrompt: "ranked for: Practical LLM inference for prod.",
      shortlistPrompt: "shortlisted for: Practical LLM inference for prod.",
    });
  });

  it("returns 503 when prompt generation is unconfigured", async () => {
    const f = fixture();
    const app = new Hono();
    app.use("*", setTestTenant());
    app.route(
      "/api/admin/onboarding",
      createOnboardingRouter({
        tenantsRepo: f.tenantsRepo,
        getSettingsRepo: () => f.settingsRepo,
        getSourcesRepo: () => ({ listEnabled: () => Promise.resolve([]) }),
        promptGeneration: null,
        processingQueue: f.processingQueue as never,
        collectorHealthQueue: f.collectorHealthQueue as never,
      }),
    );
    const res = await app.request("/api/admin/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "A newsletter about things." }),
    });
    expect(res.status).toBe(503);
  });

  it("maps PromptGenerationError to 502 and rejects short descriptions", async () => {
    const f = fixture();
    f.generate.mockRejectedValueOnce(new PromptGenerationError("nope"));
    const res = await f.app.request("/api/admin/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "A newsletter about LLM serving." }),
    });
    expect(res.status).toBe(502);

    const short = await f.app.request("/api/admin/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "too short" }),
    });
    expect(short.status).toBe(400);
  });
});

describe("POST /api/admin/onboarding/activate", () => {
  function completeFixture(overrides: Partial<Fixture> = {}) {
    return fixture({
      tenant: baseTenant({
        slug: "the-inference",
        name: "The Inference",
        headline: "The daily read.",
        onboarding: {
          furthestStep: 7,
          completed: [...ONBOARDING_STEPS],
        },
      }),
      settings: settingsRow(),
      enabledSources: 1,
      ...overrides,
    });
  }

  const activate = (app: Hono) =>
    app.request("/api/admin/onboarding/activate", { method: "POST" });

  it("422s listing every missing required step (REQ-038)", async () => {
    const f = fixture();
    const res = await activate(f.app);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "onboarding_incomplete",
      missing: ["name", "slug", "homepage", "prompts", "sources", "schedule"],
    });
    expect(f.tenantsRepo.updateStatus).not.toHaveBeenCalled();
  });

  it("422s on a single missing step (placeholder slug)", async () => {
    const f = completeFixture({
      tenant: baseTenant({
        slug: "pending-ab12cd34",
        name: "The Inference",
        headline: "The daily read.",
        onboarding: { furthestStep: 7, completed: [...ONBOARDING_STEPS] },
      }),
    });
    const res = await activate(f.app);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { missing: string[] }).missing).toEqual([
      "slug",
    ]);
  });

  it("422s when no enabled source exists even with all steps visited", async () => {
    const f = completeFixture({ enabledSources: 0 });
    const res = await activate(f.app);
    expect(((await res.json()) as { missing: string[] }).missing).toEqual([
      "sources",
    ]);
  });

  it("activates: status flips and schedulers reconcile (REQ-035)", async () => {
    const f = completeFixture();
    const res = await activate(f.app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "active" });
    expect(f.tenantsRepo.updateStatus).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      "active",
    );
    // reconcileAllForTenant: pipeline-run + social-health on processing queue,
    // collector-health on its own queue — all tenant-keyed.
    expect(f.processingQueue.upsertJobScheduler).toHaveBeenCalledWith(
      `pipeline-run:${TEST_TENANT_ID}`,
      expect.objectContaining({ tz: "UTC" }),
      expect.objectContaining({ data: { tenantId: TEST_TENANT_ID } }),
    );
    expect(f.collectorHealthQueue.upsertJobScheduler).toHaveBeenCalledWith(
      `collector-health:${TEST_TENANT_ID}`,
      expect.anything(),
      expect.anything(),
    );
  });

  it("re-activating an active tenant is a 200 no-op", async () => {
    const f = completeFixture();
    expect((await activate(f.app)).status).toBe(200);
    const callsAfterFirst =
      f.processingQueue.upsertJobScheduler.mock.calls.length;
    const res = await activate(f.app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "active", alreadyActive: true });
    expect(f.processingQueue.upsertJobScheduler.mock.calls.length).toBe(
      callsAfterFirst,
    );
    expect(f.tenantsRepo.updateStatus).toHaveBeenCalledTimes(1);
  });
});
