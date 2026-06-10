import { Hono } from "hono";
import type { Queue } from "bullmq";
import {
  AGENTLOOP_TENANT_ID,
  COLLECTOR_HEALTH_QUEUE_NAME,
  createLogger,
  createRedisConnection,
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import { Queue as BullQueue } from "bullmq";
import type {
  OnboardingProgressRow,
  SourceRow,
  SourceType,
  TenantContext,
  TenantRow,
} from "@newsletter/shared";
import { z } from "zod";
import type { TenantVariables } from "@api/middleware/types.js";
import {
  createOnboardingProgressRepo,
  type OnboardingProgressRepo,
} from "@api/repositories/onboarding-progress.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { validateSlug } from "@api/services/slug.js";
import {
  reconcileCollectorHealthSchedule,
  reconcilePipelineSchedule,
} from "@api/services/scheduler.js";

export interface OnboardingRouterDeps {
  getOnboardingRepo: (ctx: TenantContext) => OnboardingProgressRepo;
  getSourcesRepo: (ctx: TenantContext) => SourcesRepo;
  getSettingsRepo: () => UserSettingsRepo;
  getTenantsRepo: () => TenantsRepo;
  processingQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  collectorHealthQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  logger?: ReturnType<typeof createLogger>;
}

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);

const stepSchema = z.object({
  furthestStep: z.number().int().min(0).max(50),
  data: z.record(z.string(), z.unknown()),
});

const generatePromptsSchema = z.object({
  blurb: z.string().trim().min(1).max(4000),
});

const logoBase64Schema = z.object({
  contentType: z.string().min(1),
  data: z.string().min(1),
});

// Required wizard steps that gate activation (REQ-035/038).
const REQUIRED_STEP_CHECKS = [
  { key: "name", missing: "name" },
  { key: "slug", missing: "slug" },
  { key: "headline", missing: "headline" },
  { key: "rankingPrompt", missing: "prompts" },
  { key: "shortlistPrompt", missing: "prompts" },
  { key: "schedule", missing: "schedule" },
] as const;

interface SeedCandidate {
  type: SourceType;
  name: string;
  config: Record<string, unknown>;
}

// TODO(REQ-027/F51): replace with live LLM + Tavily discovery scoped per
// tenant. For now we return a small curated static seed catalog of generally
// useful AI/dev sources; the tenant explicitly chooses which to add.
const SEED_CATALOG: SeedCandidate[] = [
  { type: "hn", name: "Hacker News", config: { feeds: ["best"], sinceDays: 1 } },
  {
    type: "reddit",
    name: "r/LocalLLaMA",
    config: { subreddits: ["LocalLLaMA"], sort: "hot", sinceDays: 1 },
  },
  {
    type: "reddit",
    name: "r/MachineLearning",
    config: { subreddits: ["MachineLearning"], sort: "hot", sinceDays: 1 },
  },
  {
    type: "rss",
    name: "Simon Willison's Weblog",
    config: { listingUrl: "https://simonwillison.net/atom/everything/" },
  },
  {
    type: "rss",
    name: "The Pragmatic Engineer",
    config: { listingUrl: "https://newsletter.pragmaticengineer.com/feed" },
  },
  {
    type: "blog",
    name: "OpenAI Blog",
    config: { listingUrl: "https://openai.com/blog" },
  },
  {
    type: "blog",
    name: "Anthropic News",
    config: { listingUrl: "https://www.anthropic.com/news" },
  },
];

function fillTemplate(template: string, blurb: string): string {
  // Prepend the tenant's blurb as audience framing, leaving the default
  // prompt body intact. {{N}} placeholders are resolved later by the pipeline.
  return `${blurb.trim()}\n\n${template}`;
}

function progressData(
  row: OnboardingProgressRow | null,
): Record<string, unknown> {
  return row?.data ?? {};
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function missingRequiredSteps(
  tenant: TenantRow,
  data: Record<string, unknown>,
  sources: SourceRow[],
): string[] {
  const missing = new Set<string>();
  for (const check of REQUIRED_STEP_CHECKS) {
    const fromTenant = (tenant as Record<string, unknown>)[check.key];
    if (isPresent(fromTenant) || isPresent(data[check.key])) continue;
    missing.add(check.missing);
  }
  if (sources.length === 0) missing.add("sources");
  return [...missing];
}

function decodeBase64(data: string): Buffer | null {
  const stripped = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  try {
    return Buffer.from(stripped, "base64");
  } catch {
    return null;
  }
}

export function createOnboardingRouter(
  deps: OnboardingRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const logger = deps.logger ?? createLogger("api:onboarding");
  const app = new Hono<{ Variables: TenantVariables }>();

  const ctxOf = (c: { get: (k: "tenantCtx") => TenantContext | undefined }) =>
    c.get("tenantCtx") ?? {
      tenantId: AGENTLOOP_TENANT_ID,
      role: "tenant_admin" as const,
    };

  app.get("/progress", async (c) => {
    const ctx = ctxOf(c);
    const row = await deps.getOnboardingRepo(ctx).get();
    return c.json({
      furthestStep: row?.furthestStep ?? 0,
      data: progressData(row),
    });
  });

  app.patch("/step", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = stepSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }
    const ctx = ctxOf(c);
    const existing = await deps.getOnboardingRepo(ctx).get();
    const furthestStep = Math.max(existing?.furthestStep ?? 0, parsed.data.furthestStep);
    const merged = { ...progressData(existing), ...parsed.data.data };
    const saved = await deps.getOnboardingRepo(ctx).upsert(furthestStep, merged);
    return c.json({ furthestStep: saved.furthestStep, data: progressData(saved) });
  });

  app.get("/slug-check", async (c) => {
    const slug = (c.req.query("slug") ?? "").toLowerCase();
    if (slug === "") {
      return c.json({ status: "invalid" as const });
    }
    if (validateSlug(slug) === "invalid") {
      return c.json({ status: "invalid" as const });
    }
    const available = await deps.getTenantsRepo().isSlugAvailable(slug);
    return c.json({ status: available ? ("available" as const) : ("taken" as const) });
  });

  app.post("/generate-prompts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = generatePromptsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
    }
    // TODO(REQ-026/F26): hook a real LLM call here (default provider) to derive
    // bespoke prompts from the blurb. Fallback path: template-fill the defaults.
    return c.json({
      rankingPrompt: fillTemplate(DEFAULT_RANKING_PROMPT, parsed.data.blurb),
      shortlistPrompt: fillTemplate(DEFAULT_SHORTLIST_PROMPT, parsed.data.blurb),
    });
  });

  app.get("/discover-sources", (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    // TODO(REQ-027/F51): replace static seed catalog with live Tavily + LLM
    // discovery. For now filter the curated seed list by the query substring.
    const candidates =
      q === ""
        ? SEED_CATALOG
        : SEED_CATALOG.filter((s) => s.name.toLowerCase().includes(q));
    return c.json({ candidates });
  });

  app.post("/logo", async (c) => {
    const ctx = ctxOf(c);
    let bytes: Buffer | null = null;
    let contentType: string | null = null;

    const reqContentType = c.req.header("content-type") ?? "";
    if (reqContentType.includes("multipart/form-data")) {
      const form = await c.req.parseBody();
      const file = form.logo instanceof File ? form.logo : form.file;
      if (file instanceof File) {
        contentType = file.type;
        bytes = Buffer.from(await file.arrayBuffer());
      }
    } else {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid json" }, 400);
      }
      const parsed = logoBase64Schema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message, issues: parsed.error.issues }, 400);
      }
      contentType = parsed.data.contentType;
      bytes = decodeBase64(parsed.data.data);
    }

    if (bytes === null || contentType === null) {
      return c.json({ error: "no logo provided" }, 400);
    }

    if (!LOGO_CONTENT_TYPES.has(contentType)) {
      return c.json(
        { error: "unsupported logo type", allowed: [...LOGO_CONTENT_TYPES] },
        415,
      );
    }
    if (bytes.length > MAX_LOGO_BYTES) {
      return c.json({ error: "logo too large", maxBytes: MAX_LOGO_BYTES }, 413);
    }

    const tenants = deps.getTenantsRepo();
    const existing = await tenants.getById(ctx.tenantId);
    if (existing === null) {
      return c.json({ error: "tenant not found" }, 404);
    }
    const updated = await tenants.updateBranding(ctx.tenantId, {
      logoBytes: bytes.toString("base64"),
      logoContentType: contentType,
      logoVersion: existing.logoVersion + 1,
    });
    return c.json({
      ok: true,
      logoContentType: updated.logoContentType,
      logoVersion: updated.logoVersion,
    });
  });

  app.post("/activate", async (c) => {
    const ctx = ctxOf(c);
    const tenants = deps.getTenantsRepo();
    const tenant = await tenants.getById(ctx.tenantId);
    if (tenant === null) {
      return c.json({ error: "tenant not found" }, 404);
    }

    const progress = await deps.getOnboardingRepo(ctx).get();
    const data = progressData(progress);
    const sources = await deps.getSourcesRepo(ctx).listForTenant();

    const missing = missingRequiredSteps(tenant, data, sources);
    if (missing.length > 0) {
      return c.json({ error: "incomplete", missing }, 422);
    }

    const activated = await tenants.updateStatus(ctx.tenantId, "active");

    const settings = await deps.getSettingsRepo().getForTenant(ctx);
    if (settings !== null) {
      await reconcilePipelineSchedule(
        deps.processingQueue,
        settings,
        ctx.tenantId,
      );
      await reconcileCollectorHealthSchedule(
        deps.collectorHealthQueue,
        settings,
        ctx.tenantId,
      );
    }

    logger.info(
      { event: "onboarding.activated", tenantId: ctx.tenantId },
      "onboarding.activated",
    );
    return c.json({ ok: true, status: activated.status });
  });

  return app;
}

let defaultProcessingQueue: Queue | null = null;
function getDefaultProcessingQueue(): Queue {
  defaultProcessingQueue ??= new BullQueue("processing", {
    connection: createRedisConnection(),
  });
  return defaultProcessingQueue;
}

let defaultCollectorHealthQueue: Queue | null = null;
function getDefaultCollectorHealthQueue(): Queue {
  defaultCollectorHealthQueue ??= new BullQueue(COLLECTOR_HEALTH_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return defaultCollectorHealthQueue;
}

export function createDefaultOnboardingRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createOnboardingRouter({
    getOnboardingRepo: (ctx) =>
      createOnboardingProgressRepo(defaultGetDb(), ctx),
    getSourcesRepo: (ctx) => createSourcesRepo(defaultGetDb(), ctx),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    getTenantsRepo: () => createTenantsRepo(defaultGetDb()),
    processingQueue: getDefaultProcessingQueue(),
    collectorHealthQueue: getDefaultCollectorHealthQueue(),
  });
}
