import { Hono } from "hono";
import { z } from "zod";
import { getTenantId } from "@api/middleware/tenant-host.js";
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
import { COLLECTOR_HEALTH_QUEUE_NAME } from "@newsletter/shared";
import {
  userSettingsUpsertSchema,
  type UserSettingsUpsertBody,
} from "@api/lib/validate.js";
import {
  createNotificationSettingsRepo,
  createUserSettingsRepo,
  type NotificationSettingsRepo,
  type UserSettingsRepo,
  type UserSettingsUpsertInput,
} from "@api/repositories/user-settings.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@api/repositories/sources.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import {
  createTenantFeaturesRepo,
  type TenantFeaturesRepo,
  type TenantFeatureFlags,
} from "@api/repositories/tenant-features.js";
import { settingsToSourceRows } from "@newsletter/shared/services/sources-assembler";
import { reconcileAllForTenant } from "@api/services/scheduler.js";
import {
  defaultRettiwtFactory,
  resolveTwitterHandles,
  TwitterHandleResolutionError,
  type TwitterHandleResolverDeps,
} from "@api/services/twitter-handle-resolver.js";
import { captureAnalytics, refreshPostHogConfig } from "@api/lib/posthog.js";

type RettiwtFactory = TwitterHandleResolverDeps["rettiwtFactory"];

/** REQ-094: shortlist size is not tenant-settable. Internal default for new
 * rows; existing rows (e.g. tenant 0) keep their DB value. Mirrors the
 * pipeline fallback in run-process.ts. */
const INTERNAL_SHORTLIST_SIZE = 30;

const featureTogglesSchema = z.object({
  canonEnabled: z.boolean().optional(),
  deliverabilityEnabled: z.boolean().optional(),
  evalEnabled: z.boolean().optional(),
});

const DEFAULT_FEATURE_FLAGS: TenantFeatureFlags = {
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
};

/** REQ-094: the shortlist size never leaves the API on tenant surfaces. */
function stripShortlistSize<T extends { shortlistSize?: number }>(
  settings: T,
): Omit<T, "shortlistSize"> {
  const { shortlistSize: _shortlistSize, ...rest } = settings;
  return rest;
}

export interface SettingsRouterDeps {
  getSettingsRepo: (tenantId: string) => UserSettingsRepo;
  getNotificationSettingsRepo: (tenantId: string) => NotificationSettingsRepo;
  /** Encrypts the Slack webhook at rest (REQ-092); same KEK as social credentials. */
  cipher: Pick<CredentialCipher, "encrypt">;
  getSourcesRepo: (tenantId: string) => Pick<SourcesRepo, "replaceAll">;
  processingQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  collectorHealthQueue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;
  isTenantActive: (tenantId: string) => Promise<boolean>;
  /** Feature toggles live on the tenants row (REQ-093), not user_settings. */
  tenantFeatures: TenantFeaturesRepo;
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
    const tenantId = getTenantId(c);
    const settings = await deps.getSettingsRepo(tenantId).get();
    if (settings === null) return c.json(null);
    const notification = await deps.getNotificationSettingsRepo(tenantId).get();
    const features =
      (await deps.tenantFeatures.get(tenantId)) ?? DEFAULT_FEATURE_FLAGS;
    // NF6/REQ-092: never echo the webhook (encrypted or decrypted) — only a
    // configured/not-configured boolean leaves the API.
    return c.json({
      ...stripShortlistSize(settings),
      ...features,
      notificationEmail: notification?.notificationEmail ?? null,
      hasSlackWebhook: (notification?.slackWebhookEncrypted ?? null) !== null,
    });
  });

  app.put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    // REQ-094: the shortlist size is not tenant-settable — any client value
    // is discarded before validation and the DB value (or internal default)
    // is used instead.
    const sanitizedBody =
      typeof body === "object" && body !== null
        ? { ...body, shortlistSize: INTERNAL_SHORTLIST_SIZE }
        : body;
    const parsed = userSettingsUpsertSchema.safeParse(sanitizedBody);
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

    const togglesParsed = featureTogglesSchema.safeParse(sanitizedBody);
    if (!togglesParsed.success) {
      return c.json(
        { error: togglesParsed.error.message, issues: togglesParsed.error.issues },
        400,
      );
    }
    const toggles = togglesParsed.data;

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
      shortlistSize: INTERNAL_SHORTLIST_SIZE,
    };

    const tenantId = getTenantId(c);
    const settingsRepo = deps.getSettingsRepo(tenantId);
    // REQ-094: keep whatever the row already holds (tenant 0 keeps its tuned
    // value); only brand-new rows get the internal default.
    const existing = await settingsRepo.get();
    if (existing !== null) upsertInput.shortlistSize = existing.shortlistSize;
    const saved = await settingsRepo.upsert(upsertInput);
    // REQ-092: persist notification channels after the row exists. Omitted
    // fields stay untouched; the webhook is encrypted before it touches the DB.
    const notificationRepo = deps.getNotificationSettingsRepo(tenantId);
    if (
      parsed.data.notificationEmail !== undefined ||
      parsed.data.slackWebhookUrl !== undefined
    ) {
      await notificationRepo.update({
        ...(parsed.data.notificationEmail !== undefined
          ? { notificationEmail: parsed.data.notificationEmail }
          : {}),
        ...(parsed.data.slackWebhookUrl !== undefined
          ? {
              slackWebhookEncrypted:
                parsed.data.slackWebhookUrl === null
                  ? null
                  : deps.cipher.encrypt(parsed.data.slackWebhookUrl),
            }
          : {}),
      });
    }
    const notification = await notificationRepo.get();
    // REQ-093: feature toggles persist on the tenants row; omitted toggles
    // stay untouched.
    const hasToggleUpdate =
      toggles.canonEnabled !== undefined ||
      toggles.deliverabilityEnabled !== undefined ||
      toggles.evalEnabled !== undefined;
    const features =
      (hasToggleUpdate
        ? await deps.tenantFeatures.update(tenantId, toggles)
        : await deps.tenantFeatures.get(tenantId)) ?? DEFAULT_FEATURE_FLAGS;
    // Transitional write-through: the legacy settings UI is still the
    // source-list editor, but runs read the sources table — sync the
    // exploded rows so saves keep affecting collection. Removed when the
    // Settings panel migrates to /api/admin/sources (REQ-074). Saves
    // replace the tenant's rows wholesale, so rows added via
    // /api/admin/sources in between are superseded by the settings save.
    await deps.getSourcesRepo(tenantId).replaceAll(settingsToSourceRows(saved));
    refreshPostHogConfig(tenantId, saved);
    // REQ-063: a settings save reconciles only the caller's own schedulers —
    // keys and job data are tenant-scoped, so tenants cannot touch each other's.
    // Non-active tenants (pending_setup) get no schedulers until activation,
    // which runs its own reconcile (Phase 11).
    if (await deps.isTenantActive(tenantId)) {
      await reconcileAllForTenant(
        {
          processingQueue: deps.processingQueue,
          collectorHealthQueue: deps.collectorHealthQueue,
        },
        tenantId,
        saved,
      );
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
      tenantId,
      distinctId: "admin",
      event: "settings_updated",
      properties: {
        schedule_enabled: saved.scheduleEnabled,
        schedule_time: saved.pipelineTime,
        schedule_timezone: saved.scheduleTimezone,
        top_n: saved.topN,
      },
    });
    return c.json({
      ...stripShortlistSize(saved),
      ...features,
      notificationEmail: notification?.notificationEmail ?? null,
      hasSlackWebhook: (notification?.slackWebhookEncrypted ?? null) !== null,
    });
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
    getSettingsRepo: (tenantId) => createUserSettingsRepo(defaultGetDb(), tenantId),
    getNotificationSettingsRepo: (tenantId) =>
      createNotificationSettingsRepo(defaultGetDb(), tenantId),
    cipher: getCredentialCipher(),
    getSourcesRepo: (tenantId) => createSourcesRepo(defaultGetDb(), tenantId),
    processingQueue: getDefaultProcessingQueue(),
    collectorHealthQueue: getDefaultCollectorHealthQueue(),
    isTenantActive: async (tenantId) => {
      const tenant = await createTenantsRepo(defaultGetDb()).findById(tenantId);
      return tenant?.status === "active";
    },
    tenantFeatures: createTenantFeaturesRepo(defaultGetDb()),
  });
}
