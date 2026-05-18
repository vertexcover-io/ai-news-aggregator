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
} from "@newsletter/shared";
import { Queue as BullQueue } from "bullmq";
import {
  userSettingsUpsertSchema,
  type UserSettingsUpsertBody,
} from "@api/lib/validate.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
  type UserSettingsUpsertInput,
} from "@api/repositories/user-settings.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { reconcilePipelineSchedule } from "@api/services/scheduler.js";
import { reconcilePerArchiveJobs } from "@api/services/per-archive-schedule.js";
import {
  defaultRettiwtFactory,
  resolveTwitterHandles,
  TwitterHandleResolutionError,
  type TwitterHandleResolverDeps,
} from "@api/services/twitter-handle-resolver.js";
import { captureAnalytics, refreshPostHogConfig } from "@api/lib/posthog.js";

type RettiwtFactory = TwitterHandleResolverDeps["rettiwtFactory"];

export interface SettingsRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
  getArchiveRepo?: () => RunArchivesRepo;
  processingQueue: Pick<
    Queue,
    "upsertJobScheduler" | "removeJobScheduler" | "add" | "remove" | "getJob"
  >;
  resolveHandles?: (
    handles: string[],
    deps: TwitterHandleResolverDeps,
  ) => Promise<{ handle: string; userId: string }[]>;
  rettiwtFactory?: RettiwtFactory;
  logger?: ReturnType<typeof createLogger>;
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
    const settings = await deps.getSettingsRepo().get();
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
    };

    const saved = await deps.getSettingsRepo().upsert(upsertInput);
    refreshPostHogConfig(saved);
    await reconcilePipelineSchedule(deps.processingQueue, saved);
    if (deps.getArchiveRepo !== undefined) {
      const archives = await deps.getArchiveRepo().findRecentUnpublished({ withinDays: 2 });
      for (const archive of archives) {
        await reconcilePerArchiveJobs(
          { queue: deps.processingQueue, now: () => new Date() },
          archive.id,
          saved,
          archive,
        );
      }
    }
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

export function createDefaultSettingsRouter(): Hono {
  return createSettingsRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    processingQueue: getDefaultProcessingQueue(),
  });
}
