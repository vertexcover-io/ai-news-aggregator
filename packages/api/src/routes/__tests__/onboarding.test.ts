import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { TenantsRepo } from "../../repositories/tenants.js";
import type { OnboardingState } from "@newsletter/shared/types";

// ── Response types ──────────────────────────────────────────────────────────

interface SlugAvailableResponse {
  available: boolean;
  reason?: string;
}

interface OnboardingStateResponse {
  name: string;
  slug: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  status: string;
  onboardingState: OnboardingState | null;
}

interface PromptsResponse {
  ranking: string;
  shortlist: string;
}

interface DiscoverSourcesResponse {
  candidates: string[];
}

interface ActivateResponse {
  active?: boolean;
  error?: string;
  missing?: string[];
}

// ── Stubs ────────────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

interface TenantStub {
  id: string;
  slug: string;
  name: string;
  status: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoBytes: Uint8Array | null;
  logoContentType: string | null;
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
  customDomain: string | null;
  domainId: string | null;
  domainName: string | null;
  domainStatus: string | null;
  domainRecords: unknown;
  onboardingState: OnboardingState | null;
  oldSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeTenantStub(overrides: Partial<TenantStub> = {}): TenantStub {
  return {
    id: TENANT_ID,
    slug: "test",
    name: "Test Tenant",
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
    domainId: null,
    domainName: null,
    domainStatus: null,
    domainRecords: null,
    onboardingState: null,
    oldSlug: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

interface FakeTenantsRepo extends TenantsRepo {
  findBySlug: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findByCustomDomain: ReturnType<typeof vi.fn>;
  findByOldSlug: ReturnType<typeof vi.fn>;
  listAll: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateDomain: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeTenantsRepo(): FakeTenantsRepo {
  return {
    findBySlug: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findByCustomDomain: vi.fn().mockResolvedValue(null),
    findByOldSlug: vi.fn().mockResolvedValue(null),
    listAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    updateDomain: vi.fn(),
    update: vi.fn(),
  };
}

// ── Injects tenantCtx into every request for testing ────────────────────────

const injectTenantCtx = createMiddleware(async (c, next) => {
  c.set("tenantCtx", {
    tenantId: TENANT_ID,
    role: "tenant_admin" as const,
  });
  await next();
});

// ── Test helpers ─────────────────────────────────────────────────────────────

function makePlaceholderGeneratePrompts(): (
  blurb: string,
) => Promise<{ ranking: string; shortlist: string }> {
  return () => Promise.resolve({ ranking: "rank", shortlist: "short" });
}

function makePlaceholderDiscoverSources(): (blurb: string) => Promise<string[]> {
  return () => Promise.resolve(["https://example.com"]);
}

async function buildOnboardingApp(opts: {
  tenantsRepo?: FakeTenantsRepo;
  generatePrompts?: (blurb: string) => Promise<{ ranking: string; shortlist: string }>;
  discoverSources?: (blurb: string) => Promise<string[]>;
}): Promise<Hono> {
  const { createOnboardingRouter } = await import("../onboarding.js");
  const repo = opts.tenantsRepo ?? makeTenantsRepo();
  const app = new Hono();
  app.use("/api/onboarding/*", injectTenantCtx);
  app.route(
    "/api/onboarding",
    createOnboardingRouter({
      getTenantsRepo: () => repo,
      generatePrompts: opts.generatePrompts ?? makePlaceholderGeneratePrompts(),
      discoverSources: opts.discoverSources ?? makePlaceholderDiscoverSources(),
    }),
  );
  return app;
}

// ── Slug validation (REQ-033) ────────────────────────────────────────────────

describe("GET /api/onboarding/slug-available", () => {
  let tenantsRepo: FakeTenantsRepo;
  let app: Hono;

  beforeEach(async () => {
    tenantsRepo = makeTenantsRepo();
    app = await buildOnboardingApp({ tenantsRepo });
  });

  it("returns available for a valid, unreserved, unused slug (REQ-033)", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=my-cool-newsletter");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: true });
  });

  it("returns taken for a slug that is already in use (REQ-033)", async () => {
    tenantsRepo.findBySlug.mockResolvedValue(makeTenantStub({ slug: "taken-slug" }));
    const res = await app.request("/api/onboarding/slug-available?slug=taken-slug");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "taken" });
  });

  it("returns invalid for a slug with uppercase characters (REQ-033)", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=Bad-Slug");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "invalid" });
  });

  it("returns invalid for a slug with special characters (REQ-033)", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=bad%20slug!");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "invalid" });
  });

  it("returns invalid for a reserved slug (EDGE-003)", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=admin");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "invalid" });
  });

  it("returns invalid for an empty slug", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "invalid" });
  });

  it("returns invalid for a too-short slug (single char)", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: false, reason: "invalid" });
  });

  it("returns available for a slug with hyphens", async () => {
    const res = await app.request("/api/onboarding/slug-available?slug=my-news-42");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SlugAvailableResponse;
    expect(body).toEqual({ available: true });
  });
});

// ── GET /api/onboarding — Read state (REQ-030) ──────────────────────────────

describe("GET /api/onboarding", () => {
  it("returns existing onboarding state (REQ-030)", async () => {
    const tenantsRepo = makeTenantsRepo();
    const state: OnboardingState = { name: true, slug: true };
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({ onboardingState: state }),
    );
    const app = await buildOnboardingApp({ tenantsRepo });
    const res = await app.request("/api/onboarding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingStateResponse;
    expect(body.onboardingState).toEqual(state);
    expect(body.name).toBe("Test Tenant");
    expect(body.slug).toBe("test");
  });

  it("returns empty state when no onboarding has started", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const app = await buildOnboardingApp({ tenantsRepo });
    const res = await app.request("/api/onboarding");
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingStateResponse;
    expect(body.onboardingState).toBeNull();
  });

  it("returns 401 when no tenant context set (REQ-007)", async () => {
    const { createOnboardingRouter } = await import("../onboarding.js");
    const repo = makeTenantsRepo();
    const app = new Hono();
    app.route(
      "/api/onboarding",
      createOnboardingRouter({
        getTenantsRepo: () => repo,
        generatePrompts: makePlaceholderGeneratePrompts(),
        discoverSources: makePlaceholderDiscoverSources(),
      }),
    );
    const res = await app.request("/api/onboarding");
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/onboarding — Persist progress (REQ-030, REQ-032) ─────────────

describe("PATCH /api/onboarding", () => {
  it("persists onboarding state fields (REQ-030)", async () => {
    const tenantsRepo = makeTenantsRepo();
    const tenant = makeTenantStub();
    tenantsRepo.findById.mockResolvedValue(tenant);
    tenantsRepo.update.mockResolvedValue(tenant);
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingState: { name: true, slug: true } }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid field types", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingState: "not-an-object" }),
    });
    expect(res.status).toBe(422);
  });

  it("merges with existing onboarding state", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({ onboardingState: { name: true } }),
    );
    tenantsRepo.update.mockResolvedValue(
      makeTenantStub({ onboardingState: { name: true, slug: true } }),
    );
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingState: { slug: true } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingStateResponse;
    expect(body.onboardingState).toEqual({ name: true, slug: true });
  });
});

// ── POST /api/onboarding/generate-prompts (REQ-036) ─────────────────────────

describe("POST /api/onboarding/generate-prompts", () => {
  it("generates ranking and shortlist prompts from blurb (REQ-036)", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const generatePrompts = vi.fn().mockResolvedValue({
      ranking: "Custom ranking prompt",
      shortlist: "Custom shortlist prompt",
    });
    const app = await buildOnboardingApp({ tenantsRepo, generatePrompts });

    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blurb: "We cover AI agents and tooling" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PromptsResponse;
    expect(body.ranking).toBe("Custom ranking prompt");
    expect(body.shortlist).toBe("Custom shortlist prompt");
    expect(generatePrompts).toHaveBeenCalledWith("We cover AI agents and tooling");
  });

  it("returns 422 when blurb is missing", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when blurb is too short", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/generate-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blurb: "hi" }),
    });
    expect(res.status).toBe(422);
  });
});

// ── POST /api/onboarding/discover-sources (REQ-071, REQ-051) ────────────────

describe("POST /api/onboarding/discover-sources", () => {
  it("returns candidates without adding them to sources (REQ-071)", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const discoverSources = vi.fn().mockResolvedValue([
      "https://example.com/ai-news",
      "https://blog.openai.com",
    ]);
    const app = await buildOnboardingApp({ tenantsRepo, discoverSources });

    const res = await app.request("/api/onboarding/discover-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blurb: "AI agents" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscoverSourcesResponse;
    expect(body.candidates).toEqual([
      "https://example.com/ai-news",
      "https://blog.openai.com",
    ]);
    expect(discoverSources).toHaveBeenCalledWith("AI agents");
  });

  it("returns empty list when nothing found", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(makeTenantStub());
    const discoverSources = vi.fn().mockResolvedValue([]);
    const app = await buildOnboardingApp({ tenantsRepo, discoverSources });

    const res = await app.request("/api/onboarding/discover-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blurb: "AI agents" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscoverSourcesResponse;
    expect(body.candidates).toEqual([]);
  });
});

// ── POST /api/onboarding/activate (REQ-035, REQ-038) ────────────────────────

describe("POST /api/onboarding/activate", () => {
  it("activates tenant when all required steps complete (REQ-035)", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({
        slug: "valid-slug",
        name: "Valid Name",
        headline: "A Headline",
        onboardingState: {
          name: true,
          slug: true,
          branding: true,
          prompts: true,
          sources: true,
          schedule: true,
        },
      }),
    );
    tenantsRepo.update.mockResolvedValue(makeTenantStub({ status: "active" }));
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivateResponse;
    expect(body.active).toBe(true);
  });

  it("blocks activation and lists missing steps (REQ-038)", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({
        slug: "valid-slug",
        name: "Valid Name",
        headline: null,
        onboardingState: { name: true, slug: true },
      }),
    );
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ActivateResponse;
    expect(body.error).toBeDefined();
    expect(body.missing).toBeDefined();
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing?.length).toBeGreaterThan(0);
  });

  it("blocks activation when name is empty (REQ-038)", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({
        slug: "valid-slug",
        name: "",
        headline: "has headline",
        onboardingState: { name: true, slug: true, branding: true, prompts: true, sources: true, schedule: true },
      }),
    );
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ActivateResponse;
    expect(body.missing).toContain("name");
  });

  it("returns 400 when already active", async () => {
    const tenantsRepo = makeTenantsRepo();
    tenantsRepo.findById.mockResolvedValue(
      makeTenantStub({ status: "active" }),
    );
    const app = await buildOnboardingApp({ tenantsRepo });

    const res = await app.request("/api/onboarding/activate", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });
});

// ── Logo upload validation (REQ-039, EDGE-007) ──────────────────────────────

describe("Logo validation", () => {
  it("accepts a valid PNG within size limit", async () => {
    const { validateLogoUpload } = await import("../../lib/logo-validation.js");
    const buf = new Uint8Array(1000);
    const result = validateLogoUpload({ buffer: buf, contentType: "image/png" });
    expect(result.ok).toBe(true);
  });

  it("rejects file over 512KB (REQ-039)", async () => {
    const { validateLogoUpload } = await import("../../lib/logo-validation.js");
    const buf = new Uint8Array(600 * 1024);
    const result = validateLogoUpload({
      buffer: buf,
      contentType: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/512/i);
    }
  });

  it("rejects unsupported content types (REQ-039)", async () => {
    const { validateLogoUpload } = await import("../../lib/logo-validation.js");
    const buf = new Uint8Array(1000);
    const result = validateLogoUpload({
      buffer: buf,
      contentType: "image/gif",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unsupported/i);
    }
  });

  it("rejects empty buffer", async () => {
    const { validateLogoUpload } = await import("../../lib/logo-validation.js");
    const result = validateLogoUpload({
      buffer: new Uint8Array(0),
      contentType: "image/png",
    });
    expect(result.ok).toBe(false);
  });
});
