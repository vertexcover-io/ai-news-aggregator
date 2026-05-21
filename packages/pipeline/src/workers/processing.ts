import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getDb, createSlackNotifier } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import type { RunProcessJobPayload } from "@newsletter/shared";
import {
  handleRunProcessJob,
  type RunProcessDeps,
  type RunProcessJobData,
  type RunProcessJobLike,
  type RunProcessResult,
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
import {
  createTwitterApiClient,
  type TwitterOAuth1Credentials,
} from "@pipeline/social/twitter/api-client.js";
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
  resolveTwitterOAuth1Credentials,
} from "@pipeline/services/credential-resolver.js";
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

  const runProcessDeps =
    options.runProcessDeps ?? buildDefaultRunProcessDeps(connection);
  const dailyRunDeps =
    options.dailyRunDeps ?? buildDefaultDailyRunDeps(connection);
  const socialHealthDeps =
    options.socialHealthDeps ?? buildDefaultSocialHealthDeps();
  // NOTE: publishDeps are intentionally rebuilt per job when not injected by
  // a test/caller. Notifiers embed credential values at construction time, and
  // the design (docs/plans/2026-05-19-admin-social-config-design.md §3, §4.4)
  // promises that operators saving credentials via /admin/settings take effect
  // on the next pipeline job WITHOUT a worker restart. Caching the resolved
  // deps for the lifetime of the worker would break that contract.
  const buildPublishDeps = async (): Promise<PublishDeps> =>
    options.publishDeps ?? (await buildDefaultPublishDeps());

  return new Worker<ProcessingJobData, unknown>(
    "processing",
    async (job: Job<ProcessingJobData, unknown>) => {
      switch (job.name) {
        case "run-process": {
          const typed: RunProcessJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as unknown as RunProcessJobData,
          };
          return handleRunProcessJob(runProcessDeps, typed);
        }
        case "daily-run":
        case "pipeline-run": {
          const typed: DailyRunJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          await handleDailyRunJob(dailyRunDeps, typed);
          return undefined;
        }
        case "email-send": {
          const publishDeps = await buildPublishDeps();
          const typed: EmailSendJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as { runId?: string },
          };
          await handleEmailSendJob(publishDeps, typed);
          return undefined;
        }
        case "linkedin-post": {
          const publishDeps = await buildPublishDeps();
          const typed: LinkedInPostJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as { runId?: string },
          };
          await handleLinkedInPostJob(publishDeps, typed);
          return undefined;
        }
        case "twitter-post": {
          const publishDeps = await buildPublishDeps();
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

function buildDefaultRunProcessDeps(connection: IORedis): RunProcessDeps {
  const db = getDb();
  const runState: RunStateService = createRunStateService(connection);
  const rawItemsRepo: RawItemsRepo = createRawItemsRepo(db);
  const candidatesRepo: CandidatesRepo = createCandidatesRepo(db);
  const archiveRepo: RunArchivesRepo = createRunArchivesRepo(db);
  const userSettingsRepo: UserSettingsRepo = createUserSettingsRepo(db);
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
  const credentialsRepo = getSharedSocialCredentialsRepo();
  const twitterClient = async (): Promise<TwitterClient> => {
    const cookie = await resolveTwitterCollectorCookie({
      repo: credentialsRepo,
      env: process.env,
    });
    const rettiwt = new Rettiwt({ apiKey: cookie?.apiKey });
    return createRettiwtClient({
      rettiwt,
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
  const slackNotifier = createSlackNotifier({
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    archives: archiveRepo,
    resolveTopRankedTitle: async (archive) => {
      if (archive.rankedItems.length === 0) return null;
      const items = await rawItemsRepo.findByIds([
        archive.rankedItems[0].rawItemId,
      ]);
      return items[0]?.title ?? null;
    },
    logger: createLogger("slack"),
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
    userSettingsRepo,
    cancelSubscriber: createCancelSubscriber(connection),
    twitterClient,
    slackNotifier,
    webSearchProvider,
  };
}

function buildDefaultDailyRunDeps(connection: IORedis): DailyRunDeps {
  const db = getDb();
  const userSettingsRepo: UserSettingsRepo = createUserSettingsRepo(db);
  const queue = new Queue<RunProcessJobPayload>("processing", { connection });
  return {
    redis: connection,
    queue,
    userSettingsRepo,
  };
}

const TWITTER_OAUTH1_ENV_KEYS = [
  "TWITTER_API_KEY",
  "TWITTER_API_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_TOKEN_SECRET",
] as const;

type TwitterOAuth1EnvKey = (typeof TWITTER_OAUTH1_ENV_KEYS)[number];

type TwitterOAuth1Config =
  | { status: "configured"; credentials: TwitterOAuth1Credentials }
  | { status: "unset" }
  | { status: "partial"; missing: readonly TwitterOAuth1EnvKey[] };

function readTwitterOAuth1Config(
  env: NodeJS.ProcessEnv = process.env,
): TwitterOAuth1Config {
  const values = {
    TWITTER_API_KEY: env.TWITTER_API_KEY,
    TWITTER_API_SECRET: env.TWITTER_API_SECRET,
    TWITTER_ACCESS_TOKEN: env.TWITTER_ACCESS_TOKEN,
    TWITTER_ACCESS_TOKEN_SECRET: env.TWITTER_ACCESS_TOKEN_SECRET,
  };
  const present = TWITTER_OAUTH1_ENV_KEYS.filter(
    (key) => values[key] !== undefined && values[key] !== "",
  );
  if (present.length === 0) return { status: "unset" };
  if (present.length !== TWITTER_OAUTH1_ENV_KEYS.length) {
    return {
      status: "partial",
      missing: TWITTER_OAUTH1_ENV_KEYS.filter(
        (key) => values[key] === undefined || values[key] === "",
      ),
    };
  }
  return {
    status: "configured",
    credentials: {
      appKey: values.TWITTER_API_KEY ?? "",
      appSecret: values.TWITTER_API_SECRET ?? "",
      accessToken: values.TWITTER_ACCESS_TOKEN ?? "",
      accessSecret: values.TWITTER_ACCESS_TOKEN_SECRET ?? "",
    },
  };
}

function warnInvalidTwitterConfig(
  log: ReturnType<typeof createLogger>,
  missing: readonly TwitterOAuth1EnvKey[],
): void {
  log.warn(
    {
      event: "social.twitter.invalid_config",
      missing: [...missing],
    },
    "twitter notifier disabled: incomplete OAuth1 configuration",
  );
}

export async function buildDefaultPublishDeps(): Promise<PublishDeps> {
  const db = getDb();
  const archiveRepo = createRunArchivesRepo(db);
  const rawItemsRepo = createRawItemsRepo(db);
  const socialTokensRepo = getSharedSocialTokensRepo();
  const socialCredentialsRepo = getSharedSocialCredentialsRepo();
  const slackNotifier = createSlackNotifier({
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    archives: archiveRepo,
    resolveTopRankedTitle: async (archive) => {
      if (archive.rankedItems.length === 0) return null;
      const items = await rawItemsRepo.findByIds([
        archive.rankedItems[0].rawItemId,
      ]);
      return items[0]?.title ?? null;
    },
    logger: createLogger("slack"),
    publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
  });

  const publicArchiveBaseUrl =
    process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL ?? "";

  const linkedinCreds = await resolveLinkedInCredentials({
    repo: socialCredentialsRepo,
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
  const twitterCreds = await resolveTwitterOAuth1Credentials({
    repo: socialCredentialsRepo,
    env: process.env,
  });
  // Preserve the "partial env config" warning behavior when DB is empty:
  // the resolver returns null on partial env, but operators expect a hint
  // about which keys are missing. Only emit the warning when there's no DB row.
  if (twitterCreds === null) {
    const dbRow = await socialCredentialsRepo.getTwitter();
    if (dbRow === null) {
      const envConfig = readTwitterOAuth1Config();
      if (envConfig.status === "partial") {
        warnInvalidTwitterConfig(twitterLogger, envConfig.missing);
      }
    }
  }
  const twitterNotifier =
    twitterCreds !== null
      ? createTwitterNotifier({
          apiClient: createTwitterApiClient({
            appKey: twitterCreds.appKey,
            appSecret: twitterCreds.appSecret,
            accessToken: twitterCreds.accessToken,
            accessSecret: twitterCreds.accessSecret,
          }),
          archives: archiveRepo,
          rawItems: rawItemsRepo,
          config: {
            publicArchiveBaseUrl,
            twitterIsPremium: process.env.TWITTER_IS_PREMIUM === "true",
          },
          logger: twitterLogger,
        })
      : null;

  return {
    emailProvider: createEmailProvider(),
    subscribersRepo: createPipelineSubscribersRepo(db),
    emailSendsRepo: createPipelineEmailSendsRepo(db),
    archiveRepo,
    rawItemsRepo,
    renderNewsletter,
    // Validated at startup in index.ts — safe to assert here.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sessionSecret: process.env.SESSION_SECRET!,
    fromMail: process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io",
    replyToEmail: process.env.NEWSLETTER_REPLY_TO_EMAIL,
    baseUrl: process.env.NEWSLETTER_BASE_URL ?? "https://newsletter.vertexcover.io",
    slackNotifier,
    linkedinNotifier,
    twitterNotifier,
  };
}

export const buildDefaultNewsletterSendDeps = buildDefaultPublishDeps;

export function buildDefaultSocialHealthDeps(): SocialHealthDeps {
  const twitterLogger = createLogger("social.twitter");
  const twitterOAuth1 = readTwitterOAuth1Config();
  if (twitterOAuth1.status === "partial") {
    warnInvalidTwitterConfig(twitterLogger, twitterOAuth1.missing);
  }
  return {
    twitterApiClient: twitterOAuth1.status === "configured"
      ? createTwitterApiClient(twitterOAuth1.credentials)
      : null,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    logger: twitterLogger,
  };
}

let cachedSocialTokensRepo: SocialTokensRepo | undefined;
function getSharedSocialTokensRepo(): SocialTokensRepo {
  cachedSocialTokensRepo ??= createSocialTokensRepo(getDb());
  return cachedSocialTokensRepo;
}

let cachedSocialCredentialsRepo: SocialCredentialsRepo | undefined;
function getSharedSocialCredentialsRepo(): SocialCredentialsRepo {
  cachedSocialCredentialsRepo ??= createSocialCredentialsRepo(
    getDb(),
    getCredentialCipher(),
  );
  return cachedSocialCredentialsRepo;
}

export type {
  RunProcessDeps,
  DailyRunDeps,
  EmailSendDeps,
  PublishDeps,
  SocialHealthDeps,
  RunProcessResult,
};
