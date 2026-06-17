import { Hono } from "hono";
import type { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type {
  RunSubmitTwitterConfig,
  RunSubmitTwitterUser,
  UserSettings,
} from "@newsletter/shared";
import { DEFAULT_SHORTLIST_PROMPT } from "@newsletter/shared/constants";
import {
  settingsConfigsFromSourceRows,
  sourceRowsFromSettings,
} from "@newsletter/shared/types";
import { Queue as BullQueue } from "bullmq";
import { COLLECTOR_HEALTH_QUEUE_NAME } from "@newsletter/shared";
import {
  userSettingsUpsertSchema,
  type UserSettingsUpsertBody,
} from "@api/lib/validate.js";
import {
  scopedTenantId,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
  type UserSettingsUpsertInput,
} from "@api/repositories/user-settings.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import {
  reconcilePipelineSchedule,
  reconcileCollectorHealthSchedule,
} from "@api/services/scheduler.js";
import {
  defaultRettiwtFactory,
  resolveTwitterHandles,
  TwitterHandleResolutionError,
  type TwitterHandleResolverDeps,
} from "@api/services/twitter-handle-resolver.js";
import { captureAnalytics, refreshPostHogConfig } from "@api/lib/posthog.js";

type RettiwtFactory = TwitterHandleResolverDeps["rettiwtFactory"];

export interface SettingsRouterDeps {
  getSettingsRepo: (scope?: TenantScope) => UserSettingsRepo;
  /**
   * Sources repo for the user_settings ⇄ rows bridge (REQ-073 follow-up).
   * When a tenant has source rows they are the authoritative collection set,
   * so GET overlays the card's collector configs from them and PUT mirrors
   * card edits back onto them. Optional: when absent the card reads/writes
   * the legacy user_settings JSONB only.
   */
  getSourcesRepo?: (
    scope?: TenantScope,
  ) => Pick<SourcesRepo, "list" | "replaceAll">;
  processingQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  collectorHealthQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  resolveHandles?: (
    handles: string[],
    deps: TwitterHandleResolverDeps,
  ) => Promise<{ handle: string; userId: string }[]>;
  rettiwtFactory?: RettiwtFactory;
  logger?: ReturnType<typeof createLogger>;
}

/**
 * Baseline settings for a tenant that has source rows but no persisted
 * user_settings row yet — the overlay rides on top so the Sources card renders
 * the real rows. Non-source fields mirror the activation defaults; the first
 * Save persists a concrete row via the upsert. `id` is a nil placeholder (the
 * client strips id/updatedAt before hydrating the form).
 */
function defaultUserSettings(): UserSettings {
  return {
    id: "00000000-0000-0000-0000-000000000000",
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
    scheduleTime: "07:00",
    pipelineTime: "07:00",
    emailTime: "07:30",
    linkedinTime: "07:45",
    twitterTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "",
    shortlistPrompt: DEFAULT_SHORTLIST_PROMPT,
    shortlistSize: 30,
    updatedAt: new Date().toISOString(),
  };
}

async function resolveTwitterConfig(
  config: UserSettingsUpsertBody["twitterConfig"],
  resolver: (
    handles: string[],
    deps: TwitterHandleResolverDeps,
  ) => Promise<{ handle: string; userId: string }[]>,
  rettiwtFactory: RettiwtFactory,
): Promise<RunSubmitTwitterConfig | null> {
  if (config === null) return null;

  const resolved: RunSubmitTwitterUser[] = [];
  const unresolvedHandles: string[] = [];
  const placeholderIndex: number[] = [];

  config.users.forEach((u: NonNullable<UserSettingsUpsertBody["twitterConfig"]>["users"][number], idx: number) => {
    if (u.userId !== undefined) {
      resolved[idx] = { handle: u.handle, userId: u.userId };
    } else {
      placeholderIndex.push(idx);
      unresolvedHandles.push(u.handle);
    }
  });

  if (unresolvedHandles.length > 0) {
    const newlyResolved = await resolver(unresolvedHandles, {
      rettiwtFactory,
    });
    placeholderIndex.forEach((idx, i) => {
      const r = newlyResolved[i];
      resolved[idx] = { handle: r.handle, userId: r.userId };
    });
  }

  return {
    listIds: config.listIds,
    users: resolved,
    maxTweetsPerSource: config.maxTweetsPerSource,
    sinceHours: config.sinceHours,
  };
}

export function createSettingsRouter(deps: SettingsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:settings");
  const resolver = deps.resolveHandles ?? resolveTwitterHandles;
  const rettiwtFactory = deps.rettiwtFactory ?? defaultRettiwtFactory;
  const app = new Hono();

  app.get("/", async (c) => {
    const scope = tenantScopeFromContext(c);
    const settings = await deps.getSettingsRepo(scope).get();

    // REQ-073: once a tenant has source ROWS they are the authoritative
    // collection set, so render the card's collector configs from them
    // (mirrors the daily-run/runs precedence). This holds even when the
    // tenant has no user_settings row yet (onboarded tenants whose settings
    // were never persisted) — overlay onto a baseline so the card shows the
    // real sources instead of the client-side defaults.
    const sourcesRepo = deps.getSourcesRepo?.(scope);
    if (sourcesRepo) {
      const rows = await sourcesRepo.list();
      if (rows.length > 0) {
        const base = settings ?? defaultUserSettings();
        const overlay = settingsConfigsFromSourceRows(rows);
        return c.json({ ...base, ...overlay });
      }
    }

    // Legacy / empty tenants with no source rows: the user_settings JSONB
    // (or null) is authoritative, returned unchanged.
    return c.json(settings);
  });

  app.put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = userSettingsUpsertSchema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((issue) => issue.path[0])
        .filter((field): field is string => typeof field === "string");
      return c.json(
        {
          error: parsed.error.message,
          issues: parsed.error.issues,
          ...(fields.length > 0 ? { fields } : {}),
        },
        400,
      );
    }

    let resolvedTwitterConfig: RunSubmitTwitterConfig | null;
    try {
      resolvedTwitterConfig = await resolveTwitterConfig(
        parsed.data.twitterConfig,
        resolver,
        rettiwtFactory,
      );
    } catch (err) {
      if (err instanceof TwitterHandleResolutionError) {
        if (err.reason === "missing_api_key") {
          logger.error(
            { event: "settings.twitter.resolve_failed", reason: err.reason },
            "twitter handle resolution failed: missing api key",
          );
          return c.json(
            {
              error:
                "twitter handle resolution unavailable: RETTIWT_API_KEY not configured",
            },
            503,
          );
        }
        if (err.reason === "auth_failed") {
          logger.error(
            { event: "settings.twitter.resolve_failed", reason: err.reason },
            "twitter handle resolution failed: auth failed",
          );
          return c.json(
            {
              error:
                "twitter handle resolution unavailable: auth failed (rotate RETTIWT_API_KEY)",
            },
            503,
          );
        }
        logger.warn(
          {
            event: "settings.twitter.resolve_failed",
            reason: err.reason,
            handle: err.handle,
          },
          "twitter handle resolution failed",
        );
        return c.json(
          {
            error: "twitter handle resolution failed",
            failures: [{ handle: err.handle, reason: err.reason }],
          },
          422,
        );
      }
      throw err;
    }

    const upsertInput: UserSettingsUpsertInput = {
      topN: parsed.data.topN,
      halfLifeHours: parsed.data.halfLifeHours,
      hnEnabled: parsed.data.hnEnabled,
      hnConfig: parsed.data.hnConfig,
      redditEnabled: parsed.data.redditEnabled,
      redditConfig: parsed.data.redditConfig,
      webEnabled: parsed.data.webEnabled,
      webConfig: parsed.data.webConfig,
      twitterEnabled: parsed.data.twitterEnabled,
      twitterConfig: resolvedTwitterConfig,
      webSearchEnabled: parsed.data.webSearchEnabled,
      webSearchConfig: parsed.data.webSearchConfig,
      posthogEnabled: parsed.data.posthogEnabled,
      posthogProjectToken: parsed.data.posthogProjectToken,
      posthogHost: parsed.data.posthogHost,
      scheduleTime: parsed.data.pipelineTime,
      pipelineTime: parsed.data.pipelineTime,
      emailTime: parsed.data.emailTime,
      linkedinTime: parsed.data.linkedinTime,
      twitterTime: parsed.data.twitterTime,
      scheduleTimezone: parsed.data.scheduleTimezone,
      scheduleEnabled: parsed.data.scheduleEnabled,
      emailEnabled: parsed.data.emailEnabled,
      linkedinEnabled: parsed.data.linkedinEnabled,
      twitterPostEnabled: parsed.data.twitterPostEnabled,
      autoReview: parsed.data.autoReview,
      rankingPrompt: parsed.data.rankingPrompt,
      shortlistPrompt: parsed.data.shortlistPrompt,
      shortlistSize: parsed.data.shortlistSize,
    };

    const sessionScope = tenantScopeFromContext(c);
    const saved = await deps.getSettingsRepo(sessionScope).upsert(upsertInput);

    // REQ-073: mirror the saved collector configs back onto the tenant's
    // source ROWS — but only for tenants ALREADY on the rows path (any rows
    // exist). Legacy JSONB tenants are left untouched so a settings save
    // never silently flips their collection source.
    const sourcesRepo = deps.getSourcesRepo?.(sessionScope);
    if (sourcesRepo) {
      const existing = await sourcesRepo.list();
      if (existing.length > 0) {
        await sourcesRepo.replaceAll(sourceRowsFromSettings(saved));
      }
    }

    refreshPostHogConfig(saved);
    // P9 (REQ-060): scheduler entries carry the saving tenant so the jobs
    // they spawn are scoped to it.
    const sessionTenantId = scopedTenantId(sessionScope);
    await reconcilePipelineSchedule(deps.processingQueue, saved, sessionTenantId);
    await reconcileCollectorHealthSchedule(
      deps.collectorHealthQueue,
      saved,
      sessionTenantId,
    );
    logger.info(
      {
        event: "settings.saved",
        scheduleEnabled: saved.scheduleEnabled,
        pipelineTime: saved.pipelineTime,
        scheduleTimezone: saved.scheduleTimezone,
      },
      "settings.saved",
    );
    void captureAnalytics({
      distinctId: "admin",
      event: "settings_updated",
      properties: {
        schedule_enabled: saved.scheduleEnabled,
        schedule_time: saved.pipelineTime,
        schedule_timezone: saved.scheduleTimezone,
        top_n: saved.topN,
      },
    });
    return c.json(saved);
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

export function createDefaultSettingsRouter(): Hono {
  return createSettingsRouter({
    getSettingsRepo: (scope) => createUserSettingsRepo(defaultGetDb(), scope),
    getSourcesRepo: (scope) => createSourcesRepo(defaultGetDb(), scope),
    processingQueue: getDefaultProcessingQueue(),
    collectorHealthQueue: getDefaultCollectorHealthQueue(),
  });
}
