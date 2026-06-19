/**
 * P11 unit: onboarding routes against injected fakes.
 *
 * REQ-036 — generate-prompts returns two non-empty editable prompts (LLM
 *           stubbed — never a real Anthropic call in tests).
 * REQ-051/037 — discover-sources returns candidates and adds NOTHING.
 * REQ-039 — logo upload rejects oversize/wrong-type, prior logo untouched.
 * REQ-033 — slug-available wire shape.
 * REQ-030 — PATCH merges partial progress into the stored state.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type {
  GeneratePromptsResponse,
  OnboardingState,
  OnboardingStateResponse,
  SourceCandidate,
} from "@newsletter/shared/types/tenant";
import { createOnboardingRouter } from "@api/routes/onboarding.js";
import type { OnboardingRouterDeps } from "@api/routes/onboarding.js";
import type { TenantRow } from "@api/repositories/tenants.js";
import { MAX_LOGO_BYTES } from "@api/lib/logo-validation.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_ID,
    slug: "pending-abc123",
    previousSlug: null,
    name: "Signup Name",
    status: "pending_setup",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TenantRow;
}

interface Harness {
  app: Hono;
  updateOnboardingState: ReturnType<typeof vi.fn>;
  updateLogo: ReturnType<typeof vi.fn>;
  createSource: ReturnType<typeof vi.fn>;
  generatePrompts: ReturnType<typeof vi.fn>;
  discoverSources: ReturnType<typeof vi.fn>;
}

function makeHarness(tenant: TenantRow = makeTenant()): Harness {
  const updateOnboardingState = vi.fn((id: string, state: OnboardingState) =>
    Promise.resolve({ ...tenant, id, onboardingState: state }),
  );
  const updateLogo = vi.fn(() => Promise.resolve(tenant));
  const createSource = vi.fn();
  const generatePrompts = vi.fn(
    (): Promise<GeneratePromptsResponse> =>
      Promise.resolve({
        rankingPrompt: "Rank by hands-on usefulness.",
        shortlistPrompt: "Keep deployment items.",
      }),
  );
  const discoverSources = vi.fn(
    (): Promise<SourceCandidate[]> =>
      Promise.resolve([
        {
          type: "reddit",
          value: "LocalLLaMA",
          label: "r/LocalLLaMA",
          group: "Reddit",
        },
        {
          type: "rss",
          value: "https://blog.vllm.ai",
          label: "vLLM blog",
          group: "RSS / Blogs",
        },
      ]),
  );

  const deps: OnboardingRouterDeps = {
    getTenantsRepo: () => ({
      findById: vi.fn(() => Promise.resolve(tenant)),
      findBySlug: vi.fn(() => Promise.resolve(null)),
      updateSlug: vi.fn(() => Promise.resolve(tenant)),
      updateOnboardingState,
      updateLogo,
      completeOnboarding: vi.fn(() => Promise.resolve(tenant)),
    }),
    getSourcesRepo: () => ({
      list: vi.fn(() => Promise.resolve([])),
    }),
    getSettingsRepo: () => ({
      get: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(),
    }),
    processingQueue: {
      upsertJobScheduler: vi.fn(),
      removeJobScheduler: vi.fn(),
    } as unknown as OnboardingRouterDeps["processingQueue"],
    collectorHealthQueue: {
      upsertJobScheduler: vi.fn(),
      removeJobScheduler: vi.fn(),
    } as unknown as OnboardingRouterDeps["collectorHealthQueue"],
    generatePrompts,
    discoverSources,
  };

  const app = new Hono();
  // Simulate requireAuth: a tenant_admin session for TENANT_ID.
  app.use("*", async (c, next) => {
    c.set("tenantCtx", {
      userId: "user-1",
      tenantId: TENANT_ID,
      role: "tenant_admin" as const,
    });
    await next();
  });
  app.route("/api/onboarding", createOnboardingRouter(deps));
  return {
    app,
    updateOnboardingState,
    updateLogo,
    createSource,
    generatePrompts,
    discoverSources,
  };
}

describe("GET /api/onboarding", () => {
  it("returns status, saved state, hasLogo and sourcesCount", async () => {
    const state: OnboardingState = {
      currentStep: "slug",
      completedSteps: ["name"],
      data: { name: "The Inference" },
    };
    const { app } = makeHarness(makeTenant({ onboardingState: state }));
    const res = await app.request("/api/onboarding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingStateResponse;
    expect(body.status).toBe("pending_setup");
    expect(body.state).toEqual(state);
    expect(body.hasLogo).toBe(false);
    expect(body.sourcesCount).toBe(0);
  });
});

describe("PATCH /api/onboarding (REQ-030 partial progress)", () => {
  it("merges partial data into the existing state and persists it", async () => {
    const existing: OnboardingState = {
      currentStep: "name",
      completedSteps: [],
      data: { name: "The Inference" },
    };
    const { app, updateOnboardingState } = makeHarness(
      makeTenant({ onboardingState: existing }),
    );
    const res = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "slug",
        completedSteps: ["name"],
        data: { slug: "theinference" },
      }),
    });
    expect(res.status).toBe(200);
    expect(updateOnboardingState).toHaveBeenCalledWith(TENANT_ID, {
      currentStep: "slug",
      completedSteps: ["name"],
      data: { name: "The Inference", slug: "theinference" },
    });
  });

  it("rejects unknown fields", async () => {
    const { app, updateOnboardingState } = makeHarness();
    const res = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { hacked: true } }),
    });
    expect(res.status).toBe(400);
    expect(updateOnboardingState).not.toHaveBeenCalled();
  });
});

describe("GET /api/onboarding/slug-available (REQ-033)", () => {
  it("returns the normalized slug and its availability", async () => {
    const { app } = makeHarness();
    const res = await app.request(
      "/api/onboarding/slug-available?slug=TheInference",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      slug: "theinference",
      status: "available",
    });
  });

  it("reserved word → reserved", async () => {
    const { app } = makeHarness();
    const res = await app.request("/api/onboarding/slug-available?slug=admin");
    expect(await res.json()).toEqual({ slug: "admin", status: "reserved" });
  });

  it("missing slug param → 400", async () => {
    const { app } = makeHarness();
    const res = await app.request("/api/onboarding/slug-available");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/onboarding/generate-prompts (REQ-036, LLM stubbed)", () => {
  it("returns two non-empty prompts from the injected generator", async () => {
    const { app, generatePrompts } = makeHarness();
    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "Practical LLM inference." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GeneratePromptsResponse;
    expect(body.rankingPrompt.length).toBeGreaterThan(0);
    expect(body.shortlistPrompt.length).toBeGreaterThan(0);
    expect(generatePrompts).toHaveBeenCalledWith("Practical LLM inference.");
  });

  it("empty blurb → 400, generator not called", async () => {
    const { app, generatePrompts } = makeHarness();
    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "  " }),
    });
    expect(res.status).toBe(400);
    expect(generatePrompts).not.toHaveBeenCalled();
  });

  it("generator failure → 502", async () => {
    const { app, generatePrompts } = makeHarness();
    generatePrompts.mockRejectedValueOnce(new Error("anthropic down"));
    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "LLM inference." }),
    });
    expect(res.status).toBe(502);
  });
});

describe("POST /api/onboarding/discover-sources (REQ-051/037, Tavily stubbed)", () => {
  it("returns candidates and adds NO source rows", async () => {
    const { app, createSource } = makeHarness();
    const res = await app.request("/api/onboarding/discover-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blurb: "Practical LLM inference." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: SourceCandidate[] };
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0]?.label).toBe("r/LocalLLaMA");
    // Discovery NEVER writes sources — adding happens via POST /api/sources
    // only when the tenant clicks a pill (REQ-037).
    expect(createSource).not.toHaveBeenCalled();
  });
});

describe("POST /api/onboarding/logo (REQ-029/039)", () => {
  it("stores a valid PNG with its sniffed content type", async () => {
    const { app, updateLogo } = makeHarness();
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(PNG_BYTES),
    });
    expect(res.status).toBe(200);
    expect(updateLogo).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Buffer),
      "image/png",
    );
  });

  it("test_REQ_039_logo_rejects_oversize_and_bad_type: oversize → 400, nothing stored", async () => {
    const { app, updateLogo } = makeHarness();
    // Number(...) keeps restrict-plus-operands happy under the tests'
    // default-project lint (the @api path alias resolves loosely there).
    const big = Buffer.alloc(Number(MAX_LOGO_BYTES) + 1);
    PNG_BYTES.copy(big);
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(big),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("too_large");
    expect(updateLogo).not.toHaveBeenCalled();
  });

  it("unsupported type → 400, nothing stored", async () => {
    const { app, updateLogo } = makeHarness();
    const res = await app.request("/api/onboarding/logo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(Buffer.from("GIF89a not supported")),
    });
    expect(res.status).toBe(400);
    expect(
      ((await res.json()) as { error: string }).error,
    ).toBe("unsupported_type");
    expect(updateLogo).not.toHaveBeenCalled();
  });
});

describe("GET /api/onboarding/logo (resume preview)", () => {
  it("serves the tenant's own stored logo bytes with its content type", async () => {
    const { app } = makeHarness(
      makeTenant({ logoBytes: PNG_BYTES, logoContentType: "image/png" }),
    );
    const res = await app.request("/api/onboarding/logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("404 when no logo is stored", async () => {
    const { app } = makeHarness();
    const res = await app.request("/api/onboarding/logo");
    expect(res.status).toBe(404);
  });
});

describe("session without a tenant (super_admin)", () => {
  it("→ 403 before any dependency is touched", async () => {
    const queue = {
      upsertJobScheduler: vi.fn(),
      removeJobScheduler: vi.fn(),
    } as unknown as OnboardingRouterDeps["processingQueue"];
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("tenantCtx", {
        userId: "su-1",
        tenantId: null,
        role: "super_admin" as const,
      });
      await next();
    });
    app.route(
      "/api/onboarding",
      createOnboardingRouter({
        getTenantsRepo: () => {
          throw new Error("must not be called");
        },
        getSourcesRepo: () => {
          throw new Error("must not be called");
        },
        getSettingsRepo: () => {
          throw new Error("must not be called");
        },
        processingQueue: queue,
        collectorHealthQueue: queue,
        generatePrompts: () => Promise.reject(new Error("no")),
        discoverSources: () => Promise.reject(new Error("no")),
      }),
    );
    const res = await app.request("/api/onboarding");
    expect(res.status).toBe(403);
  });
});
