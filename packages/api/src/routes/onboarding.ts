/**
 * Onboarding wizard routes (P11, REQ-030–038, REQ-051) — auth-gated,
 * mounted at /api/onboarding behind requireAuth (app.ts). Thin handlers
 * (S-api-03): zod at the boundary, logic in services/onboarding.ts.
 *
 *   GET   /                 → OnboardingStateResponse (resume, REQ-030)
 *   PATCH /                 → merge + persist partial progress (REQ-030/032)
 *   POST  /logo             → raw image bytes; validateLogo gate (REQ-029/039)
 *   GET   /slug-available   → ?slug= → SlugAvailableResponse (REQ-033)
 *   POST  /generate-prompts → blurb → ranking+shortlist prompts (REQ-036)
 *   POST  /discover-sources → blurb → SourceCandidate[] — adds NOTHING
 *                             (REQ-051/037; clicking a pill uses /api/sources)
 *   POST  /activate         → gate + apply + schedule (REQ-035) or 409 with
 *                             the missing steps (REQ-028/038, EDGE-001)
 *
 * The LLM (Anthropic) and search (Tavily) callables are INJECTED so tests
 * always run against fakes (S-web-04 — no real external calls in tests);
 * production wiring lives in services/onboarding-ai.ts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Queue } from "bullmq";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type {
  GeneratePromptsResponse,
  OnboardingState,
  OnboardingStateResponse,
  SourceCandidate,
} from "@newsletter/shared/types/tenant";
import {
  isTenantContext,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { validateLogo } from "@api/lib/logo-validation.js";
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  activateTenant,
  checkSlugAvailability,
} from "@api/services/onboarding.js";
import {
  defaultGeneratePrompts,
  defaultDiscoverSources,
} from "@api/services/onboarding-ai.js";

type SchedulerQueue = Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;

export interface OnboardingRouterDeps {
  getTenantsRepo: () => Pick<
    TenantsRepo,
    | "findById"
    | "findBySlug"
    | "updateSlug"
    | "updateOnboardingState"
    | "updateLogo"
    | "completeOnboarding"
  >;
  getSourcesRepo: (scope?: TenantScope) => Pick<SourcesRepo, "list">;
  getSettingsRepo: (scope?: TenantScope) => Pick<UserSettingsRepo, "upsert">;
  processingQueue: SchedulerQueue;
  collectorHealthQueue: SchedulerQueue;
  /** Anthropic-backed in production; ALWAYS a fake in tests (REQ-036). */
  generatePrompts: (blurb: string) => Promise<GeneratePromptsResponse>;
  /** LLM+Tavily-backed in production; ALWAYS a fake in tests (REQ-051). */
  discoverSources: (blurb: string) => Promise<SourceCandidate[]>;
  logger?: ReturnType<typeof createLogger>;
}

const dataSchema = z
  .object({
    name: z.string().max(200).optional(),
    slug: z.string().max(63).optional(),
    headline: z.string().max(300).optional(),
    topicStrip: z.string().max(300).optional(),
    subtagline: z.string().max(300).optional(),
    blurb: z.string().max(2000).optional(),
    rankingPrompt: z.string().max(20_000).optional(),
    shortlistPrompt: z.string().max(20_000).optional(),
    fromEmail: z.string().max(320).optional(),
    pipelineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    emailTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    timezone: z.string().max(100).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    currentStep: z.string().max(50).optional(),
    completedSteps: z.array(z.string().max(50)).max(20).optional(),
    data: dataSchema.optional(),
  })
  .strict();

const blurbSchema = z.object({ blurb: z.string().trim().min(1).max(2000) });

const EMPTY_STATE: OnboardingState = { currentStep: "name", completedSteps: [] };

/** Concrete tenant id from the session, or null (super_admin / no tenant). */
function sessionTenantId(c: Context): string | null {
  const scope = tenantScopeFromContext(c);
  return isTenantContext(scope) ? scope.tenantId : null;
}

export function createOnboardingRouter(deps: OnboardingRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:onboarding");
  const app = new Hono();

  // Onboarding is a tenant-owned surface: every handler requires a concrete
  // tenant session (super_admin without impersonation has no wizard) — the
  // per-handler `sessionTenantId` null-check is that guard.

  app.get("/", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant === null) return c.json({ error: "not_found" }, 404);
    const sources = await deps
      .getSourcesRepo(tenantScopeFromContext(c))
      .list();
    const body: OnboardingStateResponse = {
      status: tenant.status,
      state: tenant.onboardingState,
      hasLogo: tenant.logoBytes !== null && tenant.logoContentType !== null,
      sourcesCount: sources.length,
    };
    return c.json(body);
  });

  app.patch("/", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const repo = deps.getTenantsRepo();
    const tenant = await repo.findById(tenantId);
    if (tenant === null) return c.json({ error: "not_found" }, 404);

    const existing = tenant.onboardingState ?? EMPTY_STATE;
    const merged: OnboardingState = {
      currentStep: parsed.data.currentStep ?? existing.currentStep,
      completedSteps: parsed.data.completedSteps ?? existing.completedSteps,
      ...(existing.data !== undefined || parsed.data.data !== undefined
        ? { data: { ...existing.data, ...parsed.data.data } }
        : {}),
    };
    const updated = await repo.updateOnboardingState(tenantId, merged);
    if (updated === null) return c.json({ error: "not_found" }, 404);
    return c.json({ state: updated.onboardingState });
  });

  // The tenant's OWN logo for the wizard's resume preview — unlike
  // /api/branding/logo this is session-scoped, not Host-resolved.
  app.get("/logo", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const tenant = await deps.getTenantsRepo().findById(tenantId);
    if (tenant?.logoBytes == null || tenant.logoContentType === null) {
      return c.json({ error: "not_found" }, 404);
    }
    c.header("Content-Type", tenant.logoContentType);
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(tenant.logoBytes));
  });

  app.post("/logo", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const verdict = validateLogo(bytes);
    if (!verdict.ok) {
      // Rejected uploads never reach the repo → prior logo intact (REQ-039).
      return c.json({ error: verdict.reason }, 400);
    }
    const updated = await deps
      .getTenantsRepo()
      .updateLogo(tenantId, Buffer.from(bytes), verdict.contentType);
    if (updated === null) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, contentType: verdict.contentType });
  });

  app.get("/slug-available", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const raw = c.req.query("slug");
    if (raw === undefined || raw.trim().length === 0) {
      return c.json({ error: "slug query param required" }, 400);
    }
    const slug = raw.trim().toLowerCase();
    const status = await checkSlugAvailability(
      { tenantsRepo: deps.getTenantsRepo() },
      slug,
      tenantId,
    );
    return c.json({ slug, status });
  });

  app.post("/generate-prompts", async (c) => {
    if (sessionTenantId(c) === null) return c.json({ error: "forbidden" }, 403);
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = blurbSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const prompts = await deps.generatePrompts(parsed.data.blurb);
      return c.json(prompts);
    } catch (err) {
      logger.error({ err }, "onboarding.generate_prompts_failed");
      return c.json({ error: "prompt_generation_failed" }, 502);
    }
  });

  app.post("/discover-sources", async (c) => {
    if (sessionTenantId(c) === null) return c.json({ error: "forbidden" }, 403);
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = blurbSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    try {
      // Returns suggestions ONLY — a row is created when the tenant clicks
      // a pill (web → POST /api/sources), never here (REQ-037).
      const candidates = await deps.discoverSources(parsed.data.blurb);
      return c.json({ candidates });
    } catch (err) {
      logger.error({ err }, "onboarding.discover_sources_failed");
      return c.json({ error: "source_discovery_failed" }, 502);
    }
  });

  app.post("/activate", async (c) => {
    const tenantId = sessionTenantId(c);
    if (tenantId === null) return c.json({ error: "forbidden" }, 403);
    const scope = tenantScopeFromContext(c);
    const result = await activateTenant(
      {
        tenantsRepo: deps.getTenantsRepo(),
        sourcesRepo: deps.getSourcesRepo(scope),
        settingsRepo: deps.getSettingsRepo(scope),
        processingQueue: deps.processingQueue,
        collectorHealthQueue: deps.collectorHealthQueue,
      },
      tenantId,
    );
    if (!result.ok) {
      return c.json(result.blocked, 409);
    }
    logger.info(
      { event: "onboarding.activated", tenantId, slug: result.tenant.slug },
      "tenant activated",
    );
    return c.json({ ok: true, slug: result.tenant.slug });
  });

  return app;
}

export function createDefaultOnboardingRouter(deps: {
  processingQueue: SchedulerQueue;
  collectorHealthQueue: SchedulerQueue;
}): Hono {
  return createOnboardingRouter({
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    getSourcesRepo: (scope) => createSourcesRepo(defaultGetDb(), scope),
    getSettingsRepo: (scope) => createUserSettingsRepo(defaultGetDb(), scope),
    processingQueue: deps.processingQueue,
    collectorHealthQueue: deps.collectorHealthQueue,
    generatePrompts: defaultGeneratePrompts,
    discoverSources: defaultDiscoverSources,
  });
}
