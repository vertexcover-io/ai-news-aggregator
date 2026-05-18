import { config } from "dotenv";
config({ path: "../../.env" });

if (!process.env.ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}

import { serve } from "@hono/node-server";
import { createLogger, getDb } from "@newsletter/shared";
import { createDefaultRunsRouter } from "@api/routes/runs.js";
import { createDefaultAdminRunsRouter } from "@api/routes/admin-runs.js";
import {
  createDefaultPublicArchivesRouter,
  createDefaultAdminArchivesRouter,
} from "@api/routes/archives.js";
import { createDefaultArchivesSearchRouter } from "@api/routes/archives-search.js";
import { createDefaultSettingsRouter } from "@api/routes/settings.js";
import { createAdminRouter } from "@api/routes/admin.js";
import { requireAdmin } from "@api/auth/middleware.js";
import { buildApp } from "@api/app.js";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import { createSubscribersRepo } from "@api/repositories/subscribers.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createEmailProvider } from "@api/lib/email/provider.js";
import { renderConfirmation } from "@api/lib/email/templates/index.js";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import { createDefaultAnalyticsRouter } from "@api/routes/analytics.js";
import { createSesEventsRepo } from "@api/repositories/ses-events.js";
import { createEmailSendsRepo } from "@api/repositories/email-sends.js";
import { verifySnsMessage } from "@api/lib/sns-verifier.js";
import { resolveBaseUrls } from "@api/lib/base-urls.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { reconcilePipelineSchedule, removeLegacySchedulers } from "@api/services/scheduler.js";

const logger = createLogger("api");

// Route table (REQ-012 / Phase 4):
//
// Public (no middleware):
//   GET  /api/archives              — listing
//   GET  /api/archives/:runId       — single archive read
//   POST /api/admin/login           — session issue
//   POST /api/admin/logout          — session clear
//
// Admin-gated (requireAdmin):
//   GET  /api/admin/me
//   ALL  /api/runs/*
//   GET/PUT /api/settings
//   PATCH /api/admin/archives/:runId
//   POST  /api/admin/archives/:runId/add-post
//   GET   /api/admin/archives/:runId/pool
//   POST  /api/admin/archives/:runId/promote
//
// Phase 5 will update the web client to call the relocated admin archive
// endpoints under /api/admin/archives/*.

const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

const emailProvider = createEmailProvider();
const fromMail = process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io";
const replyToEmail = process.env.NEWSLETTER_REPLY_TO_EMAIL;
const { baseUrl: apiBaseUrl, webBaseUrl: newsletterBaseUrl } = resolveBaseUrls(process.env);

const { Queue: BullQueue } = await import("bullmq");
const { createRedisConnection } = await import("@newsletter/shared/redis");
const processingQueue = new BullQueue("processing", { connection: createRedisConnection() });

const settingsRepoForBootstrap = createUserSettingsRepo(getDb());
await removeLegacySchedulers(processingQueue);
const settingsForBootstrap = await settingsRepoForBootstrap.get();
if (settingsForBootstrap !== null) {
  await reconcilePipelineSchedule(processingQueue, settingsForBootstrap);
}

const runArchivesRepoForSubscribe = createRunArchivesRepo(getDb());

const subscribeRouter = createSubscribeRouter({
  subscribersRepo: createSubscribersRepo(getDb()),
  sessionSecret,
  baseUrl: apiBaseUrl,
  webBaseUrl: newsletterBaseUrl,
  sendConfirmationEmail: async (email, confirmUrl) => {
    const html = await renderConfirmation({ confirmUrl, baseUrl: newsletterBaseUrl });
    await emailProvider.send({
      to: [email],
      from: fromMail,
      replyTo: replyToEmail,
      subject: "Confirm your AI Newsletter subscription",
      html,
      text: `Confirm your subscription: ${confirmUrl}`,
    });
  },
  sendNewsletterToSubscriber: async (runId, subscriberId) => {
    await processingQueue.add(
      "email-send",
      { runId, subscriberIds: [subscriberId] },
      { jobId: `email-send-${runId}-${subscriberId}` },
    );
  },
  getMostRecentReviewedArchiveId: async () => {
    const archive = await runArchivesRepoForSubscribe.findMostRecentReviewed();
    return archive?.id ?? null;
  },
});

const webhooksRouter = createWebhooksRouter({
  sesEventsRepo: createSesEventsRepo(getDb()),
  emailSendsRepo: createEmailSendsRepo(getDb()),
  subscribersRepo: createSubscribersRepo(getDb()),
  verifySns: verifySnsMessage,
  logger,
});

const app = buildApp({
  sessionSecret,
  publicArchivesRouter: createDefaultPublicArchivesRouter(),
  archivesSearchRouter: createDefaultArchivesSearchRouter(),
  adminArchivesRouter: createDefaultAdminArchivesRouter(),
  adminRunsRouter: createDefaultAdminRunsRouter(),
  runsRouter: createDefaultRunsRouter(),
  settingsRouter: createDefaultSettingsRouter(),
  adminRouter: createAdminRouter({
    adminPassword,
    sessionSecret,
    logger: {
      info: (m, meta) => {
        logger.info(meta ?? {}, m);
      },
      warn: (m, meta) => {
        logger.warn(meta ?? {}, m);
      },
    },
  }),
  requireAdminFactory: requireAdmin,
  subscribeRouter,
  webhooksRouter,
  analyticsRouter: createDefaultAnalyticsRouter(),
});

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});
