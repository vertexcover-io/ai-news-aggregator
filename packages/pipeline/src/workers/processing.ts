import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getDb, createSlackNotifier } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import type { NewsletterSendJobPayload, RunProcessJobPayload } from "@newsletter/shared";
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
  handleNewsletterSendJob,
  type NewsletterSendDeps,
  type NewsletterSendJobLike,
} from "@pipeline/workers/newsletter-send.js";
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
  newsletterSendDeps?: NewsletterSendDeps;
}

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
  // Lazily build newsletter send deps to avoid eager DB connection in tests.
  let resolvedNewsletterSendDeps: NewsletterSendDeps | undefined =
    options.newsletterSendDeps;

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
        case "daily-run": {
          const typed: DailyRunJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          await handleDailyRunJob(dailyRunDeps, typed);
          return undefined;
        }
        case "send-newsletter": {
          resolvedNewsletterSendDeps ??= buildDefaultNewsletterSendDeps();
          const typed: NewsletterSendJobLike = {
            name: job.name,
            id: job.id,
            data: job.data as unknown as NewsletterSendJobPayload,
          };
          await handleNewsletterSendJob(resolvedNewsletterSendDeps, typed);
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
  const loadFn: LoadCandidatesFn = loadCandidatesSince;
  const collectFns: CollectFns = {
    hn: collectHn,
    reddit: collectReddit,
    web: collectWeb,
    twitter: collectTwitter,
  };
  const twitterClient = createRettiwtClient({
    rettiwt: new Rettiwt({ apiKey: process.env.RETTIWT_API_KEY }),
  });
  const sendQueue = new Queue<NewsletterSendJobPayload>("send-newsletter", {
    connection,
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
    cancelSubscriber: createCancelSubscriber(connection),
    twitterClient,
    sendQueue,
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

export function buildDefaultNewsletterSendDeps(): NewsletterSendDeps {
  const db = getDb();
  const archiveRepo = createRunArchivesRepo(db);
  const rawItemsRepo = createRawItemsRepo(db);
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
    publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL,
  });
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
    sesFromEmail: process.env.SES_FROM_EMAIL ?? "newsletter@mail.vertexcover.io",
    replyToEmail: process.env.NEWSLETTER_REPLY_TO_EMAIL,
    baseUrl: process.env.NEWSLETTER_BASE_URL ?? "https://newsletter.vertexcover.io",
    slackNotifier,
  };
}

export type { RunProcessDeps, DailyRunDeps, NewsletterSendDeps, RunProcessResult };
