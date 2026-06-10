import { Hono } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { RESERVED_TENANT_SLUGS } from "@newsletter/shared/constants/tenant-slugs";
import type { OnboardingState } from "@newsletter/shared/types";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { validateLogoUpload } from "@api/lib/logo-validation.js";

// ── Slug validation ────────────────────────────────────────────────────────

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const MIN_SLUG_LENGTH = 2;
const MAX_SLUG_LENGTH = 63;

function validateSlug(slug: string): "available" | "taken" | "invalid" {
  if (!slug || slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) {
    return "invalid";
  }
  if (!SLUG_REGEX.test(slug)) {
    return "invalid";
  }
  if (RESERVED_TENANT_SLUGS.has(slug)) {
    return "invalid";
  }
  return "available";
}

// ── zod schemas ────────────────────────────────────────────────────────────

const patchOnboardingSchema = z.object({
  name: z.string().optional(),
  slug: z
    .string()
    .optional()
    .refine(
      (s) => {
        if (s !== undefined) {
          return validateSlug(s) !== "invalid";
        }
        return true;
      },
      { message: "Invalid slug format or reserved name" },
    ),
  headline: z.string().optional().nullable(),
  topicStrip: z.string().optional().nullable(),
  subtagline: z.string().optional().nullable(),
  logoBase64: z.string().optional().nullable(),
  logoContentType: z.string().optional().nullable(),
  onboardingState: z
    .record(z.string(), z.boolean())
    .optional()
    .nullable(),
  social: z
    .object({
      twitterHandle: z.string().optional(),
      linkedinUrl: z.string().optional(),
    })
    .optional(),
  email: z.string().optional(),
  schedule: z
    .object({
      pipelineTime: z.string().optional(),
      emailTime: z.string().optional(),
      scheduleTimezone: z.string().optional(),
      scheduleEnabled: z.boolean().optional(),
    })
    .optional(),
});

const generatePromptsSchema = z.object({
  blurb: z.string().min(10, "Blurb must be at least 10 characters"),
});

const discoverSourcesSchema = z.object({
  blurb: z.string().min(5, "Blurb must be at least 5 characters"),
});

// ── Required steps check ───────────────────────────────────────────────────

interface RequiredStepCheck {
  complete: boolean;
  missing: string[];
}

function checkRequiredSteps(
  tenant: {
    name: string;
    slug: string;
    headline: string | null;
    onboardingState: OnboardingState | null;
    topicStrip: string | null;
  },
): RequiredStepCheck {
  const missing: string[] = [];

  if (!tenant.name || tenant.name.trim().length === 0) {
    missing.push("name");
  }
  if (!tenant.slug || tenant.slug.length < MIN_SLUG_LENGTH) {
    missing.push("slug");
  }
  if (!tenant.headline && !tenant.topicStrip) {
    missing.push("headline");
  }
  if (!tenant.onboardingState?.prompts) {
    missing.push("prompts");
  }
  if (!tenant.onboardingState?.sources) {
    missing.push("sources");
  }
  if (!tenant.onboardingState?.schedule) {
    missing.push("schedule");
  }

  return { complete: missing.length === 0, missing };
}

// ── Router factory ─────────────────────────────────────────────────────────

export interface OnboardingRouterDeps {
  getTenantsRepo: () => TenantsRepo;
  /** Generate ranking + shortlist prompts from a blurb (Anthropic). */
  generatePrompts: (blurb: string) => Promise<{ ranking: string; shortlist: string }>;
  /** Discover source URL candidates (LLM + Tavily). */
  discoverSources: (blurb: string) => Promise<string[]>;
  /** Called on successful activation — typically reconciles schedulers. */
  onActivate?: (tenantId: string) => Promise<void>;
  logger?: ReturnType<typeof createLogger>;
}

export function createOnboardingRouter(deps: OnboardingRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:onboarding");
  const app = new Hono();

  // ── Middleware: extract tenantCtx from session ────────────────────────────
  // Skip for slug-available (public endpoint — no auth required).
  app.use("*", async (c, next) => {
    if (c.req.path === "/api/onboarding/slug-available") {
      await next();
      return;
    }
    const ctx = c.get("tenantCtx");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- c.get returns T | undefined, ctx may be undefined
    if (!ctx?.tenantId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ── GET / — read current onboarding state (REQ-030) ──────────────────────
  app.get("/", async (c) => {
    const ctx = c.get("tenantCtx");
    const tenant = await deps.getTenantsRepo().findById(ctx.tenantId);
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }

    return c.json({
      name: tenant.name,
      slug: tenant.slug,
      headline: tenant.headline,
      topicStrip: tenant.topicStrip,
      subtagline: tenant.subtagline,
      status: tenant.status,
      onboardingState: tenant.onboardingState,
    });
  });

  // ── PATCH / — persist onboarding progress (REQ-030, REQ-032) ─────────────
  app.patch("/", async (c) => {
    const ctx = c.get("tenantCtx");
    const tenant = await deps.getTenantsRepo().findById(ctx.tenantId);
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 422);
    }

    const parsed = patchOnboardingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.issues },
        422,
      );
    }

    const data = parsed.data;

    // Merge onboardingState with existing
    const mergedState: OnboardingState | null =
      data.onboardingState !== undefined
        ? data.onboardingState !== null
          ? { ...tenant.onboardingState, ...data.onboardingState }
          : tenant.onboardingState
        : tenant.onboardingState;

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.headline !== undefined) updateData.headline = data.headline;
    if (data.topicStrip !== undefined) updateData.topicStrip = data.topicStrip;
    if (data.subtagline !== undefined) updateData.subtagline = data.subtagline;
    if (data.onboardingState !== undefined) {
      updateData.onboardingState = mergedState;
    }

    // Handle slug change: validate + set oldSlug for 301 redirect
    if (data.slug !== undefined && data.slug !== tenant.slug) {
      const check = validateSlug(data.slug);
      if (check === "taken") {
        return c.json({ error: "Slug is already taken" }, 409);
      }
      if (check === "invalid") {
        return c.json({ error: "Invalid slug format" }, 422);
      }
      // Check uniqueness against DB
      const existing = await deps.getTenantsRepo().findBySlug(data.slug);
      if (existing && existing.id !== tenant.id) {
        return c.json({ error: "Slug is already taken" }, 409);
      }
      updateData.slug = data.slug;
      // Persist old slug for 301 redirects
      if (tenant.slug) {
        updateData.oldSlug = tenant.slug;
      }
    }

    // Handle logo upload
    if (data.logoBase64 !== undefined && data.logoContentType !== undefined) {
      if (data.logoBase64 !== null) {
        try {
          const logoBuffer = Uint8Array.from(
            Buffer.from(data.logoBase64, "base64"),
          );
          const validation = validateLogoUpload({
            buffer: logoBuffer,
            contentType: data.logoContentType ?? "application/octet-stream",
          });
          if (!validation.ok) {
            return c.json({ error: validation.error }, 422);
          }
          updateData.logoBytes = logoBuffer;
          updateData.logoContentType = data.logoContentType;
        } catch {
          return c.json({ error: "Invalid base64 logo data" }, 422);
        }
      } else {
        // null means remove logo
        updateData.logoBytes = null;
        updateData.logoContentType = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({
        name: tenant.name,
        slug: tenant.slug,
        headline: tenant.headline,
        topicStrip: tenant.topicStrip,
        subtagline: tenant.subtagline,
        status: tenant.status,
        onboardingState: tenant.onboardingState,
      });
    }

    try {
      const updated = await deps.getTenantsRepo().update(
        ctx.tenantId,
        updateData,
      );
      return c.json({
        name: updated.name,
        slug: updated.slug,
        headline: updated.headline,
        topicStrip: updated.topicStrip,
        subtagline: updated.subtagline,
        status: updated.status,
        onboardingState: updated.onboardingState,
      });
    } catch (err) {
      logger.error({ err }, "onboarding.patch_failed");
      return c.json({ error: "Failed to save" }, 500);
    }
  });

  // ── GET /slug-available — validate slug (REQ-033, EDGE-001, EDGE-003) ───
  app.get("/slug-available", async (c) => {
    const slug = c.req.query("slug") ?? "";
    const check = validateSlug(slug);
    if (check !== "available") {
      return c.json({ available: false, reason: check });
    }
    // Check DB uniqueness
    const existing = await deps.getTenantsRepo().findBySlug(slug);
    if (existing) {
      return c.json({ available: false, reason: "taken" });
    }
    return c.json({ available: true });
  });

  // ── POST /generate-prompts — generate from blurb (REQ-036) ──────────────
  app.post("/generate-prompts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 422);
    }

    const parsed = generatePromptsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.issues },
        422,
      );
    }

    const { blurb } = parsed.data;
    try {
      const prompts = await deps.generatePrompts(blurb);
      return c.json(prompts);
    } catch (err) {
      logger.error({ err }, "onboarding.generate_prompts_failed");
      return c.json({ error: "Failed to generate prompts" }, 500);
    }
  });

  // ── POST /discover-sources — LLM + Tavily candidates (REQ-071) ──────────
  app.post("/discover-sources", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 422);
    }

    const parsed = discoverSourcesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.issues },
        422,
      );
    }

    const { blurb } = parsed.data;
    try {
      const candidates = await deps.discoverSources(blurb);
      return c.json({ candidates });
    } catch (err) {
      logger.error({ err }, "onboarding.discover_sources_failed");
      return c.json({ error: "Failed to discover sources" }, 500);
    }
  });

  // ── POST /activate — validate required fields, set active (REQ-035, REQ-038) ──
  app.post("/activate", async (c) => {
    const ctx = c.get("tenantCtx");
    const tenant = await deps.getTenantsRepo().findById(ctx.tenantId);
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }

    if (tenant.status !== "pending_setup") {
      return c.json({ error: "Tenant is already active" }, 400);
    }

    const { complete, missing } = checkRequiredSteps(tenant);
    if (!complete) {
      return c.json(
        { error: "Required steps incomplete", missing },
        400,
      );
    }

    try {
      await deps.getTenantsRepo().update(ctx.tenantId, { status: "active" });
      if (deps.onActivate) {
        await deps.onActivate(ctx.tenantId);
      }
      return c.json({ active: true });
    } catch (err) {
      logger.error({ err }, "onboarding.activate_failed");
      return c.json({ error: "Failed to activate" }, 500);
    }
  });

  return app;
}

// ── Default factory for use in index.ts ────────────────────────────────────

export function createDefaultOnboardingRouter(): Hono {
  const db = defaultGetDb();
  const logger = createLogger("api:onboarding");

  function makeDefaultGeneratePrompts(): (blurb: string) => Promise<{ ranking: string; shortlist: string }> {
    return (blurb: string) => {
      logger.warn({ blurb }, "generatePrompts called with placeholder");
      return Promise.resolve({
        ranking: `Ranking prompt: prioritize content about ${blurb}`,
        shortlist: `Shortlist prompt: select items relevant to ${blurb}`,
      });
    };
  }

  function makeDefaultDiscoverSources(): (blurb: string) => Promise<string[]> {
    return (blurb: string) => {
      logger.warn({ blurb }, "discoverSources called with placeholder");
      return Promise.resolve([] as string[]);
    };
  }

  return createOnboardingRouter({
    getTenantsRepo: () => createTenantsRepo(db),
    generatePrompts: makeDefaultGeneratePrompts(),
    discoverSources: makeDefaultDiscoverSources(),
  });
}
