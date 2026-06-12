import { Worker } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import { capturePipelineEvent } from "@pipeline/lib/posthog.js";
import {
  COLLECTOR_HEALTH_QUEUE_NAME,
  HEALTH_CHECKABLE_COLLECTORS,
} from "@newsletter/shared/constants";
import { postToWebhook } from "@newsletter/shared";
import { buildCollectorHealthMessage } from "@newsletter/shared";
import { createCollectorHealthStore } from "@newsletter/shared/services";
import type { CollectorHealthStore } from "@newsletter/shared/services";
import type {
  HealthCheckCollector,
  CollectorHealthTrigger,
  CollectorHealthResult,
} from "@newsletter/shared/types";
import {
  runCollectorHealthCheck as defaultRunCollectorHealthCheck,
  type CheckableCollector,
  type HealthCheckSettings,
  type HealthCheckDeps,
  type CollectorHealthOutcome,
} from "@pipeline/services/collector-health/index.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import {
  getDefaultTenantScope,
  jobTenantContext,
} from "@pipeline/repositories/default-tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { createPipelineTenantsRepo } from "@pipeline/repositories/tenants.js";
import {
  resolveTenantNotificationChannels,
  type TenantNotificationChannels,
} from "@pipeline/services/tenant-notify.js";
import {
  createNotificationEmailSender,
  type NotificationEmailSender,
} from "@pipeline/services/notification-email.js";
import { createAppCredentialsRepo } from "@pipeline/repositories/app-credentials.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { resolveTwitterCollectorCookie } from "@pipeline/services/credential-resolver.js";
import { runWebCrawl } from "@pipeline/services/web-crawler.js";
import { createWebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import { Rettiwt } from "rettiwt-api";
import type { UserSettings } from "@newsletter/shared";

export interface CollectorHealthJobData {
  collectors?: HealthCheckCollector[];
  trigger: CollectorHealthTrigger;
  /** Originating tenant (P9, REQ-060); legacy entries fall back to the bridge. */
  tenantId?: string;
}

export interface CollectorHealthJobLike {
  name: string;
  id?: string;
  data: CollectorHealthJobData;
}

type PostToWebhookFn = typeof postToWebhook;

export interface CollectorHealthJobDeps {
  userSettingsRepo: UserSettingsRepo;
  /**
   * Per-job settings repo factory (P9, REQ-061): when present, the handler
   * loads settings scoped to the job's tenant (`data.tenantId`) instead of
   * the fixed `userSettingsRepo` (kept for injected-test deps and legacy
   * single-tenant wiring).
   */
  getUserSettingsRepo?: (ctx?: TenantContext) => UserSettingsRepo;
  store: CollectorHealthStore;
  runCollectorHealthCheck: (
    collector: CheckableCollector,
    settings: HealthCheckSettings,
    deps: HealthCheckDeps,
  ) => Promise<CollectorHealthOutcome>;
  /** Factory called per-job so credentials are always fresh (S-pipeline-03 / D-051) */
  buildHealthCheckDeps: () => Promise<HealthCheckDeps>;
  slackWebhookUrl: string | undefined;
  /**
   * Per-job tenant channel resolution (P16, REQ-091): when present, the
   * failure alert goes to the JOB tenant's webhook/email instead of the
   * fixed `slackWebhookUrl` (kept as the legacy fallback for injected test
   * deps). Stays MARKERLESS either way (D-111).
   */
  resolveNotificationChannels?: (
    ctx?: TenantContext,
  ) => Promise<TenantNotificationChannels>;
  notificationEmailSender?: NotificationEmailSender;
  postToWebhook: PostToWebhookFn;
  /** Emits one `collector_preflight_failed` PostHog event per failed collector. Silent no-op when PostHog is unconfigured. */
  capturePipelineEvent: (event: string, properties?: Record<string, unknown>) => void;
  logger: {
    info(fields: Record<string, unknown>, msg: string): void;
    warn(fields: Record<string, unknown>, msg: string): void;
    error(fields: Record<string, unknown>, msg: string): void;
  };
}

export interface CreateCollectorHealthWorkerOptions {
  connection?: IORedis;
  deps?: CollectorHealthJobDeps;
}

// Adapts user_settings into the per-collector HealthCheckSettings shape.
// Key differences:
// - reddit: RunSubmitRedditConfig has no `timeframe`; pipeline RedditCollectConfig does.
//   We default to "day" which matches the run-process worker's behavior.
// - web: RunSubmitWebConfig uses `RunSubmitWebSource`; HealthCheckSettings.web uses
//   `RunSubmitWebConfig` (they share the same shape from @newsletter/shared/types).
function buildHealthCheckSettings(settings: UserSettings): HealthCheckSettings {
  const result: HealthCheckSettings = {};

  if (settings.hnConfig) {
    result.hn = {
      keywords: settings.hnConfig.keywords,
      feeds: settings.hnConfig.feeds,
      pointsThreshold: settings.hnConfig.pointsThreshold,
      count: settings.hnConfig.count,
    };
  }

  if (settings.redditConfig) {
    result.reddit = {
      subreddits: settings.redditConfig.subreddits,
      sort: settings.redditConfig.sort,
      // RunSubmitRedditConfig has no timeframe field — default to "day"
      timeframe: "day",
      limit: settings.redditConfig.limit,
    };
  }

  if (settings.twitterConfig) {
    result.twitter = {
      listIds: settings.twitterConfig.listIds,
      users: settings.twitterConfig.users,
      maxTweetsPerSource: settings.twitterConfig.maxTweetsPerSource,
      sinceHours: settings.twitterConfig.sinceHours,
    };
  }

  if (settings.webConfig) {
    result.web = {
      sources: settings.webConfig.sources,
      maxItems: settings.webConfig.maxItems,
    };
  }

  if (settings.webSearchConfig) {
    result.webSearch = {
      queries: settings.webSearchConfig.queries,
      provider: settings.webSearchConfig.provider,
    };
  }

  return result;
}

// Map "web_search" enabled flag; also handle "blog" as alias for "web"
function resolveEnabledCollectors(settings: UserSettings): HealthCheckCollector[] {
  const enabled: HealthCheckCollector[] = [];
  for (const collector of HEALTH_CHECKABLE_COLLECTORS) {
    switch (collector) {
      case "hn":
        if (settings.hnEnabled) enabled.push(collector);
        break;
      case "reddit":
        if (settings.redditEnabled) enabled.push(collector);
        break;
      case "twitter":
        if (settings.twitterEnabled) enabled.push(collector);
        break;
      case "blog":
        // "blog" maps to webEnabled — the blog/web collector
        if (settings.webEnabled) enabled.push(collector);
        break;
      case "web_search":
        if (settings.webSearchEnabled) enabled.push(collector);
        break;
    }
  }
  return enabled;
}

export async function handleCollectorHealthJob(
  deps: CollectorHealthJobDeps,
  job: CollectorHealthJobLike,
): Promise<void> {
  const log = deps.logger;
  const trigger = job.data.trigger;

  // Emit one `collector_preflight_failed` PostHog event per failed collector so pre-flight
  // failures are searchable + alertable in PostHog. Silent no-op when PostHog is unconfigured
  // (capturePipelineEvent's contract). severity is constant "error" — a failed pre-flight
  // collector produces a thin/empty digest.
  const emitPreflightFailed = (
    collector: HealthCheckCollector,
    reason: string | null,
    durationMs: number | null,
  ): void => {
    deps.capturePipelineEvent("collector_preflight_failed", {
      collector,
      reason: reason ?? "unknown",
      trigger,
      durationMs,
      severity: "error",
    });
  };

  // Targets resolved before the try/catch so we can write "failed" for them on error.
  // For an explicit single-collector check the targets come from the payload; for
  // scheduled/all-enabled checks we derive them from settings — but settings.get()
  // can fail, so we default to the payload list (possibly empty) to avoid a second
  // failure inside the catch block.
  const payloadCollectors = job.data.collectors ?? [];

  // P9 (REQ-061): scheduled entries carry the owning tenant — load THAT
  // tenant's settings. Legacy entries (no tenantId) keep the fixed repo.
  const settingsRepo =
    deps.getUserSettingsRepo !== undefined
      ? deps.getUserSettingsRepo(jobTenantContext(job.data) ?? getDefaultTenantScope())
      : deps.userSettingsRepo;

  let settings: Awaited<ReturnType<typeof deps.userSettingsRepo.get>>;
  let targets: HealthCheckCollector[];

  try {
    settings = await settingsRepo.get();

    if (payloadCollectors.length > 0) {
      targets = payloadCollectors;
    } else if (settings !== null) {
      targets = resolveEnabledCollectors(settings);
    } else {
      targets = [];
    }
  } catch (err) {
    // Settings fetch failed. If the payload has explicit collectors those were already
    // set to "running" by the API (manual) or haven't been set yet (shouldn't happen).
    // Write "failed" for any explicit targets so they don't stay stuck in "running".
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { event: "collector_health.settings_error", error: msg, jobId: job.id },
      "failed to load settings",
    );
    if (payloadCollectors.length > 0) {
      const erroredAt = new Date().toISOString();
      await Promise.allSettled(
        payloadCollectors.map((c) =>
          deps.store.set({
            collector: c,
            status: "failed",
            trigger,
            checkedAt: erroredAt,
            durationMs: null,
            reason: msg,
            detail: null,
          }),
        ),
      );
      for (const c of payloadCollectors) emitPreflightFailed(c, msg, null);
    }
    throw err;
  }

  if (targets.length === 0) {
    log.info(
      { event: "collector_health.no_targets", jobId: job.id, trigger },
      "no collectors targeted — skipping",
    );
    return;
  }

  log.info(
    { event: "collector_health.job_start", jobId: job.id, trigger, collectors: targets },
    "collector health job started",
  );

  const now = new Date();

  // For scheduled trigger only: write "running" state (manual already set by API)
  if (trigger === "scheduled") {
    await Promise.all(
      targets.map((c) => deps.store.setRunning(c, "scheduled", now)),
    );
  }

  const healthCheckSettings = settings !== null ? buildHealthCheckSettings(settings) : {};

  // Guard: if buildHealthCheckDeps throws after setRunning, write "failed" for all
  // targeted collectors so they don't stay stuck in "running" (NF1 / REQ-019).
  let healthCheckDeps: Awaited<ReturnType<typeof deps.buildHealthCheckDeps>>;
  try {
    // Build per-job deps for the health check strategies (S-pipeline-03 / D-051)
    // Credentials are resolved inside the factory so admin saves take effect
    // on the next job without a worker restart.
    healthCheckDeps = await deps.buildHealthCheckDeps();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { event: "collector_health.deps_error", error: msg, jobId: job.id },
      "failed to build health check deps",
    );
    const erroredAt = new Date().toISOString();
    await Promise.allSettled(
      targets.map((c) =>
        deps.store.set({
          collector: c,
          status: "failed",
          trigger,
          checkedAt: erroredAt,
          durationMs: null,
          reason: msg,
          detail: null,
        }),
      ),
    );
    for (const c of targets) emitPreflightFailed(c, msg, null);
    throw err;
  }

  // Run all checks concurrently; one failure must not abort others (REQ-010)
  const results = await Promise.allSettled(
    targets.map(async (collector) => {
      const checkableCollector = collector as CheckableCollector;
      try {
        const outcome = await deps.runCollectorHealthCheck(
          checkableCollector,
          healthCheckSettings,
          healthCheckDeps,
        );
        const result: CollectorHealthResult = {
          collector,
          status: outcome.status,
          trigger,
          checkedAt: new Date().toISOString(),
          durationMs: outcome.durationMs,
          reason: outcome.reason,
          detail: outcome.detail,
        };
        await deps.store.set(result);
        return { collector, outcome };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(
          { event: "collector_health.check_error", collector, error: msg },
          "health check threw unexpectedly",
        );
        const failedResult: CollectorHealthResult = {
          collector,
          status: "failed",
          trigger,
          checkedAt: new Date().toISOString(),
          durationMs: null,
          reason: msg,
          detail: null,
        };
        await deps.store.set(failedResult);
        return { collector, outcome: { status: "failed" as const, durationMs: 0, reason: msg, detail: null } };
      }
    }),
  );

  // Collect failures for Slack notification + PostHog emit
  const failures: { collector: HealthCheckCollector; reason: string }[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { collector, outcome } = result.value;
      if (outcome.status === "failed") {
        failures.push({ collector, reason: outcome.reason ?? "unknown" });
        emitPreflightFailed(collector, outcome.reason, outcome.durationMs);
      }
    }
    // allSettled means "rejected" shouldn't happen (we catch above), but handle defensively
  }

  const failureCount = failures.length;
  const successCount = targets.length - failureCount;

  log.info(
    {
      event: "collector_health.job_complete",
      jobId: job.id,
      trigger,
      successCount,
      failureCount,
    },
    "collector health job completed",
  );

  if (failures.length === 0) {
    return;
  }

  // P16 (REQ-091): resolve the JOB tenant's channels — its decrypted webhook
  // and/or notification email; legacy wiring keeps the fixed global webhook.
  // D-111 holds: no notification_state marker, the alert re-fires every
  // failed check.
  const channels: TenantNotificationChannels =
    deps.resolveNotificationChannels !== undefined
      ? await deps.resolveNotificationChannels(
          jobTenantContext(job.data) ?? getDefaultTenantScope(),
        )
      : {
          slackWebhookUrl: deps.slackWebhookUrl,
          notifyEmail: undefined,
          notifyReviewReady: true,
          notifyErrors: true,
        };

  if (!channels.notifyErrors) {
    log.info(
      { event: "collector_health.alert_skipped", reason: "toggle_off", jobId: job.id },
      "collector health alert skipped (tenant error alerts off)",
    );
    return;
  }

  if (
    channels.notifyEmail !== undefined &&
    deps.notificationEmailSender !== undefined
  ) {
    try {
      await deps.notificationEmailSender.send({
        to: channels.notifyEmail,
        subject: "Collector health check failed",
        text: failures
          .map((f) => `${f.collector}: ${f.reason}`)
          .join("\n"),
      });
    } catch (err) {
      log.warn(
        {
          event: "collector_health.email_alert_failed",
          error: err instanceof Error ? err.message : String(err),
          jobId: job.id,
        },
        "collector health email alert failed",
      );
    }
  }

  if (channels.slackWebhookUrl === undefined || channels.slackWebhookUrl === "") {
    return;
  }

  const message = buildCollectorHealthMessage({ failures, trigger });

  try {
    const webhookResult = await deps.postToWebhook({
      url: channels.slackWebhookUrl,
      blocks: message.blocks,
    });

    if (!webhookResult.ok) {
      log.warn(
        {
          event: "slack.collector_health.failed",
          status: webhookResult.status,
          jobId: job.id,
        },
        "collector health slack alert failed",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      {
        event: "slack.collector_health.failed",
        error: msg,
        jobId: job.id,
      },
      "collector health slack alert failed",
    );
  }
}

export function createCollectorHealthWorker(
  options: CreateCollectorHealthWorkerOptions = {},
): Worker<CollectorHealthJobData, undefined> {
  const connection = options.connection ?? createRedisConnection();
  const workerDeps = options.deps ?? buildDefaultCollectorHealthDeps();

  return new Worker<CollectorHealthJobData, undefined>(
    COLLECTOR_HEALTH_QUEUE_NAME,
    async (job: Job<CollectorHealthJobData, undefined>) => {
      const jobLike: CollectorHealthJobLike = {
        name: job.name,
        id: job.id,
        data: job.data,
      };
      await handleCollectorHealthJob(workerDeps, jobLike);
      return undefined;
    },
    { connection },
  );
}

export function buildDefaultCollectorHealthDeps(): CollectorHealthJobDeps {
  const db = getDb();

  return {
    userSettingsRepo: createUserSettingsRepo(db, getDefaultTenantScope()),
    // P9 (REQ-061): the handler prefers this factory, scoping settings to the
    // job's tenant; the fixed repo above remains the legacy fallback.
    getUserSettingsRepo: (ctx?: TenantContext) => createUserSettingsRepo(db, ctx),
    store: createCollectorHealthStore(createRedisConnection()),
    runCollectorHealthCheck: defaultRunCollectorHealthCheck,
    // Per-job factory so credentials are always fresh (S-pipeline-03 / D-051)
    buildHealthCheckDeps: async (): Promise<HealthCheckDeps> => {
      // Shared collector cookie is APP-LEVEL (P12, REQ-086) — resolved from
      // app_credentials, never tenant-scoped.
      const appCredentialsRepo = createAppCredentialsRepo(
        getDb(),
        getCredentialCipher(),
      );
      const twitterCookie = await resolveTwitterCollectorCookie({
        appRepo: appCredentialsRepo,
        env: process.env,
      });
      const tavilyApiKey = process.env.TAVILY_API_KEY;
      return {
        credentialResolver: {
          resolveTwitterCollectorCookie: () => Promise.resolve(twitterCookie),
          tavilyApiKey,
        },
        runWebCrawl,
        // RettiwtFacade requires list.tweets + user.timeline —
        // the raw Rettiwt instance satisfies that interface directly.
        rettiwtClientFactory: (apiKey: string) => new Rettiwt({ apiKey }),
        tavilyFactory: tavilyApiKey
          ? (key: string) => createWebSearchProvider("tavily", { tavilyApiKey: key })
          : undefined,
        logger: createLogger("worker:collector-health"),
      };
    },
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    // P16 (REQ-091): per-job tenant channel resolution — decrypts the JOB
    // tenant's webhook at send time; global env webhook stays the fallback.
    resolveNotificationChannels: (ctx?: TenantContext) =>
      resolveTenantNotificationChannels({
        tenantsRepo: createPipelineTenantsRepo(getDb(), ctx),
        cipher: getCredentialCipher(),
        env: process.env,
        logger: createLogger("tenant-notify"),
      }),
    notificationEmailSender: createNotificationEmailSender(),
    postToWebhook,
    capturePipelineEvent,
    logger: createLogger("worker:collector-health"),
  };
}
