import { Hono } from "hono";
import { z } from "zod";
import type { Queue } from "bullmq";
import { Queue as BullQueue } from "bullmq";
import {
  COLLECTOR_HEALTH_QUEUE_NAME,
  createLogger,
  createRedisConnection,
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
  getDb as defaultGetDb,
  RESERVED_SLUGS,
  type UserSettings,
} from "@newsletter/shared";
import { getTenantId } from "@api/middleware/tenant-host.js";
import {
  createTenantsRepo,
  PENDING_SLUG_PREFIX,
  type TenantOnboarding,
  type TenantOnboardingStateRecord,
  type TenantsRepo,
} from "@api/repositories/tenants.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
  type UserSettingsUpsertInput,
} from "@api/repositories/user-settings.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import { reconcileAllForTenant } from "@api/services/scheduler.js";
import {
  createDefaultPromptGeneration,
  PromptGenerationError,
  type PromptGeneration,
} from "@api/services/prompt-generation.js";

export const ONBOARDING_STEPS = [
  "name",
  "slug",
  "logo",
  "homepage",
  "prompts",
  "channels",
  "sources",
  "schedule",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export type SlugCheckStatus = "available" | "taken" | "invalid" | "reserved";

// REQ-033: lowercase alphanumerics + hyphens, 3-30 chars, no leading/trailing hyphen.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** Format + reserved-word half of the slug check (EDGE-003); uniqueness is a
 * separate DB probe. The "pending-" prefix is reserved for signup placeholders. */
export function checkSlugFormat(slug: string): "ok" | "invalid" | "reserved" {
  if (!SLUG_RE.test(slug)) return "invalid";
  if (RESERVED_SLUGS.includes(slug)) return "reserved";
  if (slug.startsWith(PENDING_SLUG_PREFIX)) return "reserved";
  return "ok";
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const nameDataSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const slugDataSchema = z.object({ slug: z.string().trim() }).strict();
const homepageDataSchema = z
  .object({
    headline: z.string().trim().min(1).max(200),
    topicStrip: z.string().trim().min(1).max(300).optional(),
    subtagline: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .strict();
const promptsDataSchema = z
  .object({
    rankingPrompt: z.string().trim().min(1).max(20000),
    shortlistPrompt: z.string().trim().min(1).max(20000),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
const scheduleDataSchema = z
  .object({
    pipelineTime: z.string().regex(HHMM_RE),
    emailTime: z.string().regex(HHMM_RE),
    timezone: z.string().trim().min(1).max(64),
    emailEnabled: z.boolean().optional(),
    linkedinEnabled: z.boolean().optional(),
    twitterPostEnabled: z.boolean().optional(),
  })
  .strict();

const patchBodySchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("name"), data: nameDataSchema }).strict(),
  z.object({ step: z.literal("slug"), data: slugDataSchema }).strict(),
  z.object({ step: z.literal("logo") }).strict(),
  z.object({ step: z.literal("homepage"), data: homepageDataSchema }).strict(),
  z.object({ step: z.literal("prompts"), data: promptsDataSchema }).strict(),
  z.object({ step: z.literal("channels") }).strict(),
  z.object({ step: z.literal("sources") }).strict(),
  z.object({ step: z.literal("schedule"), data: scheduleDataSchema }).strict(),
]);

const generatePromptsBodySchema = z
  .object({ description: z.string().trim().min(10).max(2000) })
  .strict();

const GENERATE_PROMPTS_MAX = 5;
const GENERATE_PROMPTS_WINDOW_MS = 10 * 60 * 1000;

// Seed row for tenants whose first settings write happens mid-wizard. Source
// enables stay false (the sources table is the collection source of truth);
// scheduleEnabled flips true on the schedule step.
const SETTINGS_SEED: UserSettingsUpsertInput = {
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
  pipelineTime: "06:00",
  emailTime: "07:30",
  linkedinTime: "08:00",
  twitterTime: "08:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
  rankingPrompt: DEFAULT_RANKING_PROMPT,
  shortlistPrompt: DEFAULT_SHORTLIST_PROMPT,
  shortlistSize: 30,
};

function toUpsertInput(current: UserSettings): UserSettingsUpsertInput {
  const { id: _id, updatedAt: _updatedAt, ...rest } = current;
  return rest;
}

async function mergeSettings(
  repo: UserSettingsRepo,
  patch: Partial<UserSettingsUpsertInput>,
): Promise<UserSettings> {
  const current = await repo.get();
  const base = current ? toUpsertInput(current) : SETTINGS_SEED;
  return repo.upsert({ ...base, ...patch });
}

function advanceProgress(
  current: TenantOnboarding | null,
  step: OnboardingStepId,
): TenantOnboarding {
  const completed = new Set(current?.completed ?? []);
  completed.add(step);
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const nextStep = Math.min(stepIndex + 1, ONBOARDING_STEPS.length - 1);
  return {
    ...current,
    furthestStep: Math.max(current?.furthestStep ?? 0, nextStep),
    completed: ONBOARDING_STEPS.filter((s) => completed.has(s)),
  };
}

function tenantWire(t: TenantOnboardingStateRecord) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    headline: t.headline,
    topicStrip: t.topicStrip,
    subtagline: t.subtagline,
    logoVersion: t.logoVersion,
  };
}

// REQ-038: activation requires real persisted data, not just step markers,
// wherever the data is distinguishable (slug, headline, sources, settings row).
function computeMissing(
  tenant: TenantOnboardingStateRecord,
  settings: UserSettings | null,
  enabledSourceCount: number,
): OnboardingStepId[] {
  const completed = new Set(tenant.onboarding?.completed ?? []);
  const missing: OnboardingStepId[] = [];
  if (!completed.has("name") || tenant.name.trim() === "") missing.push("name");
  if (tenant.slug.startsWith(PENDING_SLUG_PREFIX)) missing.push("slug");
  if (!tenant.headline?.trim()) missing.push("homepage");
  if (!completed.has("prompts")) missing.push("prompts");
  if (enabledSourceCount < 1) missing.push("sources");
  if (!completed.has("schedule") || settings === null) missing.push("schedule");
  return missing;
}

type SchedulerQueue = Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;

export type OnboardingTenantsRepo = Pick<
  TenantsRepo,
  | "getOnboardingState"
  | "updateOnboarding"
  | "updateBranding"
  | "setSlug"
  | "isSlugTaken"
  | "updateStatus"
>;

export interface OnboardingRouterDeps {
  tenantsRepo: OnboardingTenantsRepo;
  getSettingsRepo: (tenantId: string) => UserSettingsRepo;
  getSourcesRepo: (tenantId: string) => Pick<SourcesRepo, "listEnabled">;
  /** null ⇒ no ANTHROPIC_API_KEY — POST /generate-prompts returns 503. */
  promptGeneration: PromptGeneration | null;
  processingQueue: SchedulerQueue;
  collectorHealthQueue: SchedulerQueue;
  logger?: ReturnType<typeof createLogger>;
}

/** Onboarding wizard API (auth-gated; tenant = session tenant, so it works
 * under impersonation unchanged). Mounted at /api/admin/onboarding. */
export function createOnboardingRouter(deps: OnboardingRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:onboarding");
  const app = new Hono();

  // REQ-030: everything the wizard needs to resume where the tenant left off.
  app.get("/state", async (c) => {
    const tenantId = getTenantId(c);
    const tenant = await deps.tenantsRepo.getOnboardingState(tenantId);
    if (!tenant) return c.json({ error: "not_found" }, 404);
    const settings = await deps.getSettingsRepo(tenantId).get();
    const enabled = await deps.getSourcesRepo(tenantId).listEnabled();
    return c.json({
      tenant: tenantWire(tenant),
      onboarding: tenant.onboarding ?? { furthestStep: 0, completed: [] },
      prompts: settings
        ? {
            rankingPrompt: settings.rankingPrompt,
            shortlistPrompt: settings.shortlistPrompt,
          }
        : null,
      schedule: settings
        ? {
            pipelineTime: settings.pipelineTime,
            emailTime: settings.emailTime,
            timezone: settings.scheduleTimezone,
            emailEnabled: settings.emailEnabled,
            linkedinEnabled: settings.linkedinEnabled,
            twitterPostEnabled: settings.twitterPostEnabled,
          }
        : null,
      enabledSourceCount: enabled.length,
    });
  });

  // REQ-033 / EDGE-001 / EDGE-003. Always 200 — the status IS the answer.
  app.get("/slug-check", async (c) => {
    const slug = (c.req.query("slug") ?? "").trim().toLowerCase();
    const format = checkSlugFormat(slug);
    if (format !== "ok") {
      return c.json({ status: format satisfies SlugCheckStatus });
    }
    const taken = await deps.tenantsRepo.isSlugTaken(slug, getTenantId(c));
    return c.json({
      status: (taken ? "taken" : "available") satisfies SlugCheckStatus,
    });
  });

  // REQ-030/032: partial save per step + progress advance. Logo bytes, source
  // rows, and channel connections are written through their own Phase 5/8/10
  // endpoints — their steps here only record progress.
  app.patch("/state", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const tenantId = getTenantId(c);
    const tenant = await deps.tenantsRepo.getOnboardingState(tenantId);
    if (!tenant) return c.json({ error: "not_found" }, 404);

    const patch = parsed.data;
    switch (patch.step) {
      case "name": {
        await deps.tenantsRepo.updateBranding(tenantId, {
          name: patch.data.name,
        });
        break;
      }
      case "slug": {
        const slug = patch.data.slug.toLowerCase();
        const format = checkSlugFormat(slug);
        if (format !== "ok") {
          return c.json({ error: "invalid_slug", status: format }, 422);
        }
        const result = await deps.tenantsRepo.setSlug(tenantId, slug);
        if (!result.ok) {
          if (result.reason === "taken") {
            // EDGE-001: lost the race — unique constraint is the arbiter.
            return c.json({ error: "slug_taken", status: "taken" }, 409);
          }
          return c.json({ error: "not_found" }, 404);
        }
        break;
      }
      case "homepage": {
        await deps.tenantsRepo.updateBranding(tenantId, {
          headline: patch.data.headline,
          ...(patch.data.topicStrip !== undefined
            ? { topicStrip: patch.data.topicStrip }
            : {}),
          ...(patch.data.subtagline !== undefined
            ? { subtagline: patch.data.subtagline }
            : {}),
        });
        break;
      }
      case "prompts": {
        await mergeSettings(deps.getSettingsRepo(tenantId), {
          rankingPrompt: patch.data.rankingPrompt,
          shortlistPrompt: patch.data.shortlistPrompt,
        });
        break;
      }
      case "schedule": {
        await mergeSettings(deps.getSettingsRepo(tenantId), {
          pipelineTime: patch.data.pipelineTime,
          emailTime: patch.data.emailTime,
          scheduleTimezone: patch.data.timezone,
          scheduleEnabled: true,
          ...(patch.data.emailEnabled !== undefined
            ? { emailEnabled: patch.data.emailEnabled }
            : {}),
          ...(patch.data.linkedinEnabled !== undefined
            ? { linkedinEnabled: patch.data.linkedinEnabled }
            : {}),
          ...(patch.data.twitterPostEnabled !== undefined
            ? { twitterPostEnabled: patch.data.twitterPostEnabled }
            : {}),
        });
        break;
      }
      case "logo":
      case "channels":
      case "sources":
        break;
    }

    let onboarding = advanceProgress(tenant.onboarding, patch.step);
    if (patch.step === "prompts" && patch.data.description !== undefined) {
      onboarding = { ...onboarding, description: patch.data.description };
    }
    await deps.tenantsRepo.updateOnboarding(tenantId, onboarding);
    const updated = await deps.tenantsRepo.getOnboardingState(tenantId);
    return c.json({
      onboarding,
      tenant: updated ? tenantWire(updated) : tenantWire(tenant),
    });
  });

  // REQ-036: candidates only — the user edits, then PATCH {step:"prompts"} saves.
  // Per-tenant sliding window so a looping admin can't run up LLM spend.
  const generateHits = new Map<string, number[]>();
  app.post("/generate-prompts", async (c) => {
    if (!deps.promptGeneration) {
      return c.json(
        {
          error: "prompt_generation_unavailable",
          message: "ANTHROPIC_API_KEY is not configured",
        },
        503,
      );
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = generatePromptsBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const tenantId = getTenantId(c);
    const now = Date.now();
    const hits = (generateHits.get(tenantId) ?? []).filter(
      (t) => now - t < GENERATE_PROMPTS_WINDOW_MS,
    );
    if (hits.length >= GENERATE_PROMPTS_MAX) {
      return c.json({ error: "rate_limited" }, 429);
    }
    generateHits.set(tenantId, [...hits, now]);
    // REQ-032: keep the description across leave-and-return (it also feeds the
    // sources step's discovery topic) — persist even if generation fails.
    const tenant = await deps.tenantsRepo.getOnboardingState(tenantId);
    if (tenant) {
      await deps.tenantsRepo.updateOnboarding(tenantId, {
        ...(tenant.onboarding ?? { furthestStep: 0, completed: [] }),
        description: parsed.data.description,
      });
    }
    try {
      const prompts = await deps.promptGeneration.generate(
        parsed.data.description,
      );
      return c.json(prompts);
    } catch (err) {
      if (err instanceof PromptGenerationError) {
        logger.warn({ err }, "onboarding.generate-prompts.failed");
        return c.json({ error: "prompt_generation_failed" }, 502);
      }
      throw err;
    }
  });

  // REQ-035/038: validates completeness, flips status, starts schedulers.
  // Re-activating an active tenant is a 200 no-op.
  app.post("/activate", async (c) => {
    const tenantId = getTenantId(c);
    const tenant = await deps.tenantsRepo.getOnboardingState(tenantId);
    if (!tenant) return c.json({ error: "not_found" }, 404);
    if (tenant.status === "active") {
      return c.json({ status: "active", alreadyActive: true });
    }
    const settings = await deps.getSettingsRepo(tenantId).get();
    const enabled = await deps.getSourcesRepo(tenantId).listEnabled();
    const missing = computeMissing(tenant, settings, enabled.length);
    if (missing.length > 0 || settings === null) {
      return c.json({ error: "onboarding_incomplete", missing }, 422);
    }
    await deps.tenantsRepo.updateStatus(tenantId, "active");
    await deps.tenantsRepo.updateOnboarding(tenantId, {
      ...tenant.onboarding,
      furthestStep: ONBOARDING_STEPS.length - 1,
      completed: [...(tenant.onboarding?.completed ?? [])],
    });
    // REQ-035: activation is the only reconcile path for pending_setup tenants
    // (the settings PUT skips non-active tenants via isTenantActive).
    await reconcileAllForTenant(
      {
        processingQueue: deps.processingQueue,
        collectorHealthQueue: deps.collectorHealthQueue,
      },
      tenantId,
      settings,
    );
    logger.info(
      { event: "onboarding.activated", tenantId, slug: tenant.slug },
      "tenant activated",
    );
    return c.json({ status: "active" });
  });

  return app;
}

let defaultProcessingQueue: Queue | null = null;
let defaultCollectorHealthQueue: Queue | null = null;

export function createDefaultOnboardingRouter(): Hono {
  defaultProcessingQueue ??= new BullQueue("processing", {
    connection: createRedisConnection(),
  });
  defaultCollectorHealthQueue ??= new BullQueue(COLLECTOR_HEALTH_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return createOnboardingRouter({
    tenantsRepo: createTenantsRepo(defaultGetDb()),
    getSettingsRepo: (tenantId) => createUserSettingsRepo(defaultGetDb(), tenantId),
    getSourcesRepo: (tenantId) => createSourcesRepo(defaultGetDb(), tenantId),
    promptGeneration: createDefaultPromptGeneration({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }),
    processingQueue: defaultProcessingQueue,
    collectorHealthQueue: defaultCollectorHealthQueue,
  });
}
