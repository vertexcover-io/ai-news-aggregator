import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
  socialTestKey,
} from "@newsletter/shared";
import type {
  RunProcessJobPayload,
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
  createSocialTokensRepo,
  type SocialTokensRepo,
} from "@api/repositories/social-tokens.js";
import { reconcileDailyRunSchedule } from "@api/services/scheduler.js";
import {
  defaultRettiwtFactory,
  resolveTwitterHandles,
  TwitterHandleResolutionError,
  type TwitterHandleResolverDeps,
} from "@api/services/twitter-handle-resolver.js";

type RettiwtFactory = TwitterHandleResolverDeps["rettiwtFactory"];

export interface SocialTestPostQueueLike {
  add(
    name: string,
    data: { platform: "linkedin" | "twitter"; requestId: string },
    opts: { jobId: string },
  ): Promise<unknown>;
}

export interface SocialTestPostRedisLike {
  get(key: string): Promise<string | null>;
}

export interface SettingsRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
  processingQueue: Pick<
    Queue,
    "upsertJobScheduler" | "removeJobScheduler"
  >;
  socialTestPostQueue?: SocialTestPostQueueLike;
  socialTestRedis?: SocialTestPostRedisLike;
  socialTokensRepo?: SocialTokensRepo;
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

  config.users.forEach((u, idx) => {
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

  app.get("/social-status", async (c) => {
    const repo = deps.socialTokensRepo;
    if (!repo) {
      return c.json({
        linkedin: { configured: false },
        twitter: { configured: false },
      });
    }
    const [linkedin, twitter] = await Promise.all([
      repo.hasToken("linkedin"),
      repo.hasToken("twitter"),
    ]);
    return c.json({
      linkedin: { configured: linkedin },
      twitter: { configured: twitter },
    });
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
      return c.json(
        { error: parsed.error.message, issues: parsed.error.issues },
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
      hnConfig: parsed.data.hnConfig,
      redditConfig: parsed.data.redditConfig,
      webConfig: parsed.data.webConfig,
      twitterConfig: resolvedTwitterConfig,
      scheduleTime: parsed.data.scheduleTime,
      scheduleTimezone: parsed.data.scheduleTimezone,
      scheduleEnabled: parsed.data.scheduleEnabled,
    };

    const saved = await deps.getSettingsRepo().upsert(upsertInput);
    await reconcileDailyRunSchedule(deps.processingQueue, saved);
    logger.info(
      {
        event: "settings.saved",
        scheduleEnabled: saved.scheduleEnabled,
        scheduleTime: saved.scheduleTime,
        scheduleTimezone: saved.scheduleTimezone,
      },
      "settings.saved",
    );
    return c.json(saved);
  });

  const testPostBodySchema = z.object({
    platform: z.enum(["linkedin", "twitter"]),
  });

  app.post("/test-social-post", async (c) => {
    if (!deps.socialTestPostQueue) {
      return c.json({ error: "test post unavailable" }, 503);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = testPostBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const requestId = randomUUID();
    await deps.socialTestPostQueue.add(
      "social-test-post",
      { platform: parsed.data.platform, requestId },
      { jobId: `social-test-${requestId}` },
    );
    logger.info(
      { event: "social.test_post.enqueued", platform: parsed.data.platform, requestId },
      "social.test_post.enqueued",
    );
    return c.json({ requestId }, 202);
  });

  // Returns {status:"pending"} for both pre-result and post-TTL-expiry; v1
  // intentionally does not distinguish (UI gives up after 30s of polling).
  app.get("/test-social-post/:requestId", async (c) => {
    if (!deps.socialTestRedis) {
      return c.json({ error: "test post unavailable" }, 503);
    }
    const requestId = c.req.param("requestId");
    const value = await deps.socialTestRedis.get(socialTestKey(requestId));
    if (value === null) {
      return c.json({ status: "pending" });
    }
    return c.json(JSON.parse(value));
  });

  return app;
}

let defaultProcessingQueue: Queue<RunProcessJobPayload> | null = null;
function getDefaultProcessingQueue(): Queue<RunProcessJobPayload> {
  defaultProcessingQueue ??= new BullQueue<RunProcessJobPayload>("processing", {
    connection: createRedisConnection(),
  });
  return defaultProcessingQueue;
}

export interface CreateDefaultSettingsRouterOptions {
  socialTestPostQueue?: SocialTestPostQueueLike;
  socialTestRedis?: SocialTestPostRedisLike;
}

export function createDefaultSettingsRouter(
  options: CreateDefaultSettingsRouterOptions = {},
): Hono {
  return createSettingsRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    processingQueue: getDefaultProcessingQueue(),
    socialTestPostQueue: options.socialTestPostQueue,
    socialTestRedis: options.socialTestRedis,
    socialTokensRepo: createSocialTokensRepo(defaultGetDb()),
  });
}
