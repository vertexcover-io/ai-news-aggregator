import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import type { RunProcessJobPayload } from "@newsletter/shared";
import {
  handleRunProcessJob,
  type RunProcessDeps,
  type RunProcessJobData,
  type RunProcessJobLike,
  type CollectFns,
} from "@pipeline/workers/run-process.js";
import { createCancelSubscriber } from "@pipeline/services/cancel-subscriber.js";
import {
  handleDailyRunJob,
  type DailyRunDeps,
  type DailyRunJobLike,
} from "@pipeline/workers/daily-run.js";
import {
  handleEmailSendJob,
  type EmailSendDeps,
  type EmailSendJobLike,
} from "@pipeline/workers/email-send.js";
import {
  handleLinkedInPostJob,
  type LinkedInPostDeps,
  type LinkedInPostJobLike,
} from "@pipeline/workers/linkedin-post.js";
import {
  handleTwitterPostJob,
  type TwitterPostDeps,
  type TwitterPostJobLike,
} from "@pipeline/workers/twitter-post.js";
import {
  handleSocialHealthJob,
  type SocialHealthDeps,
  type SocialHealthJobLike,
} from "@pipeline/workers/social-health.js";
import { createLinkedInApiClient } from "@pipeline/social/linkedin/api-client.js";
import { buildTenantTwitterApiClient } from "@pipeline/social/twitter/tenant-client.js";
import { createLinkedInNotifier } from "@pipeline/social/linkedin/notifier.js";
import { createTwitterNotifier } from "@pipeline/social/twitter/notifier.js";
import {
  createSocialTokensRepo,
  type SocialTokensRepo,
} from "@pipeline/repositories/social-tokens.js";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@pipeline/repositories/social-credentials.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  resolveLinkedInCredentials,
  resolveTwitterCollectorCookie,
} from "@pipeline/services/credential-resolver.js";
import {
  createTenantNotifier,
  createDefaultNotificationEmailClient,
} from "@pipeline/services/tenant-notifier.js";
import {
  resolveBroadcastSender,
  resolveEmailBranding,
  tenantPublicBaseUrl,
} from "@pipeline/services/email-broadcast.js";
import { createPipelineSendingDomainsRepo } from "@pipeline/repositories/sending-domains.js";
import { createPipelineTenantsRepo } from "@pipeline/repositories/tenants.js";
import { createNotificationSettingsRepo } from "@pipeline/repositories/user-settings.js";
import {
  createRunStateService,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@pipeline/repositories/raw-items.js";
import {
  createCandidatesRepo,
  type CandidatesRepo,
} from "@pipeline/repositories/candidates.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";
import { createRunLogRepo } from "@pipeline/repositories/run-logs.js";
import {
  createPipelineSubscribersRepo,
} from "@pipeline/repositories/subscribers.js";
import {
  createPipelineEmailSendsRepo,
} from "@pipeline/repositories/email-sends.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@pipeline/repositories/user-settings.js";
import { createSourcesRepo } from "@pipeline/repositories/sources.js";
import {
  loadCandidatesSince,
  type LoadCandidatesFn,
} from "@pipeline/services/candidate-loader.js";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { collectTwitter } from "@pipeline/collectors/twitter/index.js";
import { createRettiwtClient } from "@pipeline/collectors/twitter/clients/rettiwt.js";
import { refreshRettiwtCsrfToken } from "@pipeline/collectors/twitter/clients/rettiwt-auth.js";
import type { TwitterClient } from "@pipeline/collectors/twitter/types.js";
import { collectWebSearch } from "@pipeline/collectors/web-search/index.js";
import { createWebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import { Rettiwt } from "rettiwt-api";
import { rankCandidates } from "@pipeline/processors/rank.js";
import { shortlistCandidates } from "@pipeline/processors/shortlist.js";
import { renderNewsletter } from "@pipeline/lib/email-render.js";
import { createEmailProvider } from "@pipeline/lib/email-provider.js";
import { jobTenantId } from "@pipeline/lib/job-tenant.js";
import { createTwitterCollectorThrottle } from "@pipeline/lib/twitter-throttle.js";
import { parsePipelineStartJitterMs } from "@newsletter/shared";
import { APP_CREDENTIALS_TENANT_ID } from "@newsletter/shared/constants";

const logger = createLogger("worker:processing");

export interface CreateProcessingWorkerOptions {
  connection?: IORedis;
  runProcessDeps?: RunProcessDeps;
  dailyRunDeps?: DailyRunDeps;
  publishDeps?: PublishDeps;
  socialHealthDeps?: SocialHealthDeps;
}

type PublishDeps = EmailSendDeps & LinkedInPostDeps & TwitterPostDeps;

// Discriminated by job.name; payload shape is heterogeneous between routes.
type ProcessingJobData = Record<string, unknown>;

export function createProcessingWorker(
  options: CreateProcessingWorkerOptions = {},
): Worker<ProcessingJobData, unknown> {
  const connection = options.connection ?? createRedisConnection();

  // Deps are built PER JOB (when not injected by a test/caller): the seam
  // scopes every repository to the job's tenant, which is only known at the
  // job boundary. Notifiers also embed credential values at construction time,
  // and the design (docs/plans/2026-05-19-admin-social-config-design.md §3,
  // §4.4) promises that operators saving credentials via /admin/settings take
  // effect on the next pipeline job WITHOUT a worker restart.
  // Composition-time env parses (per worker process, not per job).
  const startJitterMs = parsePipelineStartJitterMs(
    process.env.PIPELINE_START_JITTER_MS,
  );

  const runProcessDepsFor = (tenantId: string): RunProcessDeps =>
    options.runProcessDeps ?? buildDefaultRunProcessDeps(connection, tenantId);
  const dailyRunDepsFor = (tenantId: string): DailyRunDeps =>
    options.dailyRunDeps ??
    buildDefaultDailyRunDeps(connection, tenantId, startJitterMs);
  const socialHealthDeps =
    options.socialHealthDeps ?? buildDefaultSocialHealthDeps();
  const buildPublishDeps = async (tenantId: string): Promise<PublishDeps> =>
    options.publishDeps ?? (await buildDefaultPublishDeps(tenantId));

  return new Worker<ProcessingJobData, unknown>(
    "processing",
    async (job: Job<ProcessingJobData, unknown>) => {
      const tenantId = jobTenantId(job.data);
      switch (job.name) {
        case "run-process": {
          const typed: RunProcessJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as unknown as RunProcessJobData,
          };
          return handleRunProcessJob(runProcessDepsFor(tenantId), typed);
        }
        case "daily-run":
        case "pipeline-run": {
          const typed: DailyRunJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          await handleDailyRunJob(dailyRunDepsFor(tenantId), typed);
          return undefined;
        }
        case "email-send": {
          const publishDeps = await buildPublishDeps(tenantId);
          const typed: EmailSendJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as { runId?: string },
          };
          await handleEmailSendJob(publishDeps, typed);
          return undefined;
        }
        case "linkedin-post": {
          const publishDeps = await buildPublishDeps(tenantId);
          const typed: LinkedInPostJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as { runId?: string },
          };
          await handleLinkedInPostJob(publishDeps, typed);
          return undefined;
        }
        case "twitter-post": {
          const publishDeps = await buildPublishDeps(tenantId);
          const typed: TwitterPostJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as { runId?: string },
          };
          await handleTwitterPostJob(publishDeps, typed);
          return undefined;
        }
        case "social-health": {
          const typed: SocialHealthJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          await handleSocialHealthJob(socialHealthDeps, typed);
          return undefined;
        }
        default: {
          logger.warn(
            { event: "processing.unknown_job", jobId: job.id, jobName: job.name },
            "processing.unknown_job",
          );
          return undefined;
        }
      }
    },
    { connection },
  );
}

function buildDefaultRunProcessDeps(
  connection: IORedis,
  tenantId: string,
): RunProcessDeps {
  const db = getDb();
  const runState: RunStateService = createRunStateService(connection);
  const rawItemsRepo: RawItemsRepo = createRawItemsRepo(db, tenantId);
  const candidatesRepo: CandidatesRepo = createCandidatesRepo(db, tenantId);
  const archiveRepo: RunArchivesRepo = createRunArchivesRepo(db, tenantId);
  const runLogRepo = createRunLogRepo(db, tenantId);
  const userSettingsRepo: UserSettingsRepo = createUserSettingsRepo(db, tenantId);
  const loadFn: LoadCandidatesFn = loadCandidatesSince;
  // TAVILY_API_KEY resolved at worker startup. Env-driven only (no DB equivalent),
  // so process-startup resolution is correct — no per-job refresh needed.
  const webSearchProvider = process.env.TAVILY_API_KEY
    ? createWebSearchProvider("tavily", { tavilyApiKey: process.env.TAVILY_API_KEY })
    : undefined;
  const collectFns: CollectFns = {
    hn: collectHn,
    reddit: collectReddit,
    web: collectWeb,
    twitter: collectTwitter,
    webSearch: collectWebSearch,
  };
  // Per-job factory: resolves cookies from `social_credentials.twitter_collector`
  // first (admin-managed), falling back to RETTIWT_API_KEY env var. This is the
  // freshness contract: admin saves at /admin/settings take effect on the next
  // job without a worker restart. Rettiwt accepts an undefined apiKey (guest
  // mode); the collector itself classifies the first auth failure as `auth`,
  // which the Slack notice surfaces.
  // The shared Twitter collector cookie is an app-level credential (F62/F66):
  // it always lives in tenant 0's store, regardless of the job's tenant.
  const credentialsRepo = createSocialCredentialsRepo(
    db,
    APP_CREDENTIALS_TENANT_ID,
    getCredentialCipher(),
  );
  const twitterThrottle = createTwitterCollectorThrottle(connection);
  const twitterClient = async (): Promise<TwitterClient> => {
    const cookie = await resolveTwitterCollectorCookie({
      repo: credentialsRepo,
      env: process.env,
    });
    const rettiwt = new Rettiwt({ apiKey: cookie?.apiKey });
    return createRettiwtClient({
      rettiwt,
      throttle: twitterThrottle,
      auth: cookie
        ? {
            refreshCsrfToken: () =>
              refreshRettiwtCsrfToken({
                rettiwt,
                repo: credentialsRepo,
                credentialSource: cookie.source,
              }),
          }
        : undefined,
    });
  };
  const slackNotifier = createTenantNotifier({
    tenantId,
    settingsRepo: createNotificationSettingsRepo(db, tenantId),
    cipher: getCredentialCipher(),
    archives: archiveRepo,
    resolveTopRankedTitle: async (archive) => {
      if (archive.rankedItems.length === 0) return null;
      const items = await rawItemsRepo.findByIds([
        archive.rankedItems[0].rawItemId,
      ]);
      return items[0]?.title ?? null;
    },
    logger: createLogger("notify"),
    emailClient: createDefaultNotificationEmailClient(),
    publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
  });
  return {
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    shortlistFn: (candidates, opts) => shortlistCandidates(candidates, opts),
    rankFn: (candidates, opts) => rankCandidates(candidates, opts),
    collectFns,
    archiveRepo,
    runLogRepo,
    userSettingsRepo,
    cancelSubscriber: createCancelSubscriber(connection),
    twitterClient,
    slackNotifier,
    webSearchProvider,
  };
}

function buildDefaultDailyRunDeps(
  connection: IORedis,
  tenantId: string,
  startJitterMs: number,
): DailyRunDeps {
  const db = getDb();
  const userSettingsRepo: UserSettingsRepo = createUserSettingsRepo(db, tenantId);
  const queue = new Queue<RunProcessJobPayload>("processing", { connection });
  return {
    redis: connection,
    queue,
    userSettingsRepo,
    sourcesRepo: createSourcesRepo(db, tenantId),
    tenantId,
    startJitterMs,
  };
}

export async function buildDefaultPublishDeps(
  tenantId: string,
): Promise<PublishDeps> {
  const db = getDb();
  const cipher = getCredentialCipher();
  const archiveRepo = createRunArchivesRepo(db, tenantId);
  const rawItemsRepo = createRawItemsRepo(db, tenantId);
  const socialTokensRepo: SocialTokensRepo = createSocialTokensRepo(
    db,
    tenantId,
    cipher,
  );
  const socialCredentialsRepo: SocialCredentialsRepo =
    createSocialCredentialsRepo(db, tenantId, cipher);
  const slackNotifier = createTenantNotifier({
    tenantId,
    settingsRepo: createNotificationSettingsRepo(db, tenantId),
    cipher,
    archives: archiveRepo,
    resolveTopRankedTitle: async (archive) => {
      if (archive.rankedItems.length === 0) return null;
      const items = await rawItemsRepo.findByIds([
        archive.rankedItems[0].rawItemId,
      ]);
      return items[0]?.title ?? null;
    },
    logger: createLogger("notify"),
    emailClient: createDefaultNotificationEmailClient(),
    publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
  });

  // F14/REQ-034: public archive/unsubscribe links must point at the TENANT's
  // host — the platform base URL serves a not-found for other tenants' runs.
  // Tenant 0 (or a missing row) keeps the legacy env-configured base URLs.
  const tenantsRepo = createPipelineTenantsRepo(db);
  const tenant = await tenantsRepo.findById(tenantId);
  const tenantBaseUrl = tenantPublicBaseUrl({
    tenantId,
    tenant,
    env: process.env,
  });
  const publicArchiveBaseUrl =
    tenantBaseUrl ??
    process.env.PUBLIC_BASE_URL ??
    process.env.NEWSLETTER_BASE_URL ??
    "";

  // REQ-080/082: the LinkedIn client id/secret is an app-level shared secret —
  // always resolved from the APP_CREDENTIALS_TENANT_ID store (env fallback,
  // NF3), never the job tenant's store. The tenant's own store only holds its
  // OAuth member token (social_tokens), read by the notifier via socialTokensRepo.
  const appCredentialsRepo = createSocialCredentialsRepo(
    db,
    APP_CREDENTIALS_TENANT_ID,
    cipher,
  );
  const linkedinCreds = await resolveLinkedInCredentials({
    repo: appCredentialsRepo,
    env: process.env,
  });
  const linkedinNotifier =
    linkedinCreds !== null
      ? createLinkedInNotifier({
          apiClient: createLinkedInApiClient(),
          archives: archiveRepo,
          rawItems: rawItemsRepo,
          tokens: socialTokensRepo,
          config: {
            clientId: linkedinCreds.clientId,
            clientSecret: linkedinCreds.clientSecret,
            apiVersion: linkedinCreds.apiVersion,
            publicArchiveBaseUrl,
          },
          logger: createLogger("social.linkedin"),
        })
      : null;

  const twitterLogger = createLogger("social.twitter");
  // Per-tenant posting client: OAuth2 token row first; tenant 0 falls back to
  // legacy OAuth1 manual keys (DB-first, then env — NF3).
  const twitterApiClient = await buildTenantTwitterApiClient({
    tenantId,
    tokens: socialTokensRepo,
    credentials: socialCredentialsRepo,
    logger: twitterLogger,
    env: process.env,
  });
  const twitterNotifier =
    twitterApiClient !== null
      ? createTwitterNotifier({
          apiClient: twitterApiClient,
          archives: archiveRepo,
          rawItems: rawItemsRepo,
          config: {
            publicArchiveBaseUrl,
            twitterIsPremium: process.env.TWITTER_IS_PREMIUM === "true",
          },
          logger: twitterLogger,
        })
      : null;

  // REQ-053/EDGE-006: broadcasts only go out from the tenant's verified
  // sending domain (tenant 0 without a row keeps env FROM_MAIL, NF3).
  const broadcastSender = await resolveBroadcastSender({
    tenantId,
    sendingDomainsRepo: createPipelineSendingDomainsRepo(db, tenantId),
    envFromMail: process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io",
    fromLocalPart: process.env.BROADCAST_FROM_LOCALPART,
  });
  const branding = await resolveEmailBranding({
    tenantId,
    tenantsRepo,
  });

  return {
    broadcastSender,
    branding,
    emailProvider: createEmailProvider(),
    subscribersRepo: createPipelineSubscribersRepo(db, tenantId),
    emailSendsRepo: createPipelineEmailSendsRepo(db, tenantId),
    archiveRepo,
    rawItemsRepo,
    renderNewsletter,
    // Validated at startup in index.ts — safe to assert here.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sessionSecret: process.env.SESSION_SECRET!,
    fromMail: process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io",
    replyToEmail: process.env.NEWSLETTER_REPLY_TO_EMAIL,
    baseUrl:
      tenantBaseUrl ??
      process.env.NEWSLETTER_BASE_URL ??
      "https://newsletter.vertexcover.io",
    slackNotifier,
    linkedinNotifier,
    twitterNotifier,
  };
}

export const buildDefaultNewsletterSendDeps = buildDefaultPublishDeps;

function buildDefaultSocialHealthDeps(): SocialHealthDeps {
  const cipher = getCredentialCipher();
  return {
    getTwitterClient: (tenantId) =>
      buildTenantTwitterApiClient({
        tenantId,
        tokens: createSocialTokensRepo(getDb(), tenantId, cipher),
        credentials: createSocialCredentialsRepo(getDb(), tenantId, cipher),
        logger: createLogger("social.twitter"),
        env: process.env,
      }),
    getTokensRepo: (tenantId) => createSocialTokensRepo(getDb(), tenantId, cipher),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  };
}

