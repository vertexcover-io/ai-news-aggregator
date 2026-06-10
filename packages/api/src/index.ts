import { config } from "dotenv";
config({ path: "../../.env" });

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}

import { serve } from "@hono/node-server";
import { createLogger, getDb, createSlackNotifier } from "@newsletter/shared";
import { createDefaultRunsRouter } from "@api/routes/runs.js";
import { createDefaultAdminRunsRouter } from "@api/routes/admin-runs.js";
import { createDefaultAdminEvalRouter } from "@api/routes/admin-eval.js";
import {
  createDefaultPublicArchivesRouter,
  createDefaultAdminArchivesRouter,
} from "@api/routes/archives.js";
import { createDefaultArchivesSearchRouter } from "@api/routes/archives-search.js";
import { createDefaultPublicHomeRouter } from "@api/routes/home.js";
import { createDefaultPublicMustReadRouter } from "@api/routes/must-read.js";
import { createDefaultPublicSourcesRouter } from "@api/routes/sources.js";
import { createDefaultSettingsRouter } from "@api/routes/settings.js";
import { createDefaultCollectorHealthRouter } from "@api/routes/collector-health.js";
import { createDefaultSourcesAdminRouter } from "@api/routes/sources-admin.js";
import { createDefaultAdminSocialCredentialsRouter } from "@api/routes/admin-social-credentials.js";
import { createSuperAppCredentialsRouter } from "@api/routes/super-app-credentials.js";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { createAppCredentialsRepo } from "@api/repositories/app-credentials.js";
import {
  createLinkedInOAuthRouter,
  createLinkedInOAuthCallbackRouter,
} from "@api/routes/linkedin-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
} from "@api/routes/twitter-oauth.js";
import { createSocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import { createSocialTokensRepo } from "@api/repositories/social-tokens.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createDefaultAdminMustReadRouter } from "@api/routes/admin-must-read.js";
import { createAdminRouter } from "@api/routes/admin.js";
import { requireAuth } from "@api/auth/middleware.js";
import { buildApp } from "@api/app.js";
import { createResolveTenant } from "@api/middleware/resolve-tenant.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { APP_HOST, CUSTOM_DOMAIN_MAP, ROOT_DOMAIN } from "@api/config/domains.js";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import { createSubscribersRepo } from "@api/repositories/subscribers.js";
import { createFeedbackEventsRepo } from "@api/repositories/feedback-events.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createEmailProvider } from "@api/lib/email/provider.js";
import { renderConfirmation } from "@api/lib/email/templates/index.js";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import { createDefaultAnalyticsRouter } from "@api/routes/analytics.js";
import { createDefaultAnalyticsConfigRouter } from "@api/routes/analytics-config.js";
import { createSesEventsRepo } from "@api/repositories/ses-events.js";
import { createEmailSendsRepo } from "@api/repositories/email-sends.js";
import { verifySnsMessage } from "@api/lib/sns-verifier.js";
import { resolveBaseUrls } from "@api/lib/base-urls.js";
import {
  reconcileCollectorHealthSchedule,
  reconcilePipelineSchedule,
  removeLegacySchedulers,
} from "@api/services/scheduler.js";
import { captureException, configurePostHog, shutdownAnalytics } from "@api/lib/posthog.js";
import { createOnboardingRouter } from "@api/routes/onboarding.js";
import { createLogoRouter } from "@api/routes/logo.js";
import { createSendingDomainRouter } from "@api/routes/sending-domain.js";
import { createNotificationsRouter } from "@api/routes/notifications.js";
import { createFeaturesRouter } from "@api/routes/features.js";
import { Resend } from "resend";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import { createUsersRepo } from "@api/repositories/users.js";
import { createAuthRouter } from "@api/routes/auth.js";
import { hashPassword, verifyPassword } from "@api/services/password.js";

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
const { COLLECTOR_HEALTH_QUEUE_NAME } = await import("@newsletter/shared");
const processingQueue = new BullQueue("processing", { connection: createRedisConnection() });
const collectorHealthQueue = new BullQueue(COLLECTOR_HEALTH_QUEUE_NAME, { connection: createRedisConnection() });
// Shared Redis connection for OAuth state storage (SET/GET/DEL — not a BullMQ queue).
const oauthRedis = createRedisConnection();

const settingsRepoForBootstrap = createUserSettingsRepo(getDb(), BOOTSTRAP_CONTEXT);
await removeLegacySchedulers(processingQueue);
const settingsForBootstrap = await settingsRepoForBootstrap.get();
if (settingsForBootstrap !== null) {
  await reconcilePipelineSchedule(processingQueue, settingsForBootstrap);
  await reconcileCollectorHealthSchedule(collectorHealthQueue, settingsForBootstrap);
}

const runArchivesRepoForSubscribe = createRunArchivesRepo(getDb(), BOOTSTRAP_CONTEXT);
configurePostHog(async () => createUserSettingsRepo(getDb(), BOOTSTRAP_CONTEXT).get());

const slackNotifier = createSlackNotifier({
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  archives: runArchivesRepoForSubscribe,
  resolveTopRankedTitle: () => Promise.resolve(null),
  logger: createLogger("slack"),
  publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
});

const subscribeRouter = createSubscribeRouter({
  subscribersRepo: createSubscribersRepo(getDb(), BOOTSTRAP_CONTEXT),
  feedbackEventsRepo: createFeedbackEventsRepo(getDb(), BOOTSTRAP_CONTEXT),
  feedbackCampaign: process.env.FEEDBACK_CAMPAIGN ?? "2026-06-reading-check",
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
  slackNotifier,
});

const webhooksRouter = createWebhooksRouter({
  sesEventsRepo: createSesEventsRepo(getDb(), BOOTSTRAP_CONTEXT),
  emailSendsRepo: createEmailSendsRepo(getDb(), BOOTSTRAP_CONTEXT),
  subscribersRepo: createSubscribersRepo(getDb(), BOOTSTRAP_CONTEXT),
  verifySns: verifySnsMessage,
  slackNotifier,
  logger,
});

const linkedInOAuthDeps = {
  getCredRepo: () =>
    createSocialCredentialsRepo(getDb(), getCredentialCipher(), BOOTSTRAP_CONTEXT),
  getTokenRepo: () =>
    createSocialTokensRepo(getDb(), BOOTSTRAP_CONTEXT, getCredentialCipher()),
  redis: oauthRedis,
  env: process.env,
};

// Twitter OAuth2 resolves app-level client id/secret from app_credentials (super-admin managed).
const twitterOAuthDeps = {
  getCredRepo: () =>
    createSocialCredentialsRepo(getDb(), getCredentialCipher(), BOOTSTRAP_CONTEXT),
  getTokenRepo: () =>
    createSocialTokensRepo(getDb(), BOOTSTRAP_CONTEXT, getCredentialCipher()),
  redis: oauthRedis,
  env: process.env,
  resolveTwitterOAuth2App: async () => {
    const repo = createAppCredentialsRepo(getDb(), getCredentialCipher());
    const tw = await repo.getTwitter();
    if (tw) return { clientId: tw.clientId, clientSecret: tw.clientSecret };
    // Env fallback
    const clientId = process.env.TWITTER_OAUTH2_CLIENT_ID;
    const clientSecret = process.env.TWITTER_OAUTH2_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
    return null;
  },
};

const app = buildApp({
  sessionSecret,
  authRouter: createAuthRouter({
    usersRepo: createUsersRepo(getDb()),
    tenantsRepo: createTenantsRepo(getDb()),
    sessionSecret,
    logger,
    hashPassword,
    verifyPassword,
  }),
  resolveTenant: createResolveTenant({
    tenantsRepo: createTenantsRepo(getDb()),
    appHost: APP_HOST,
    rootDomain: ROOT_DOMAIN,
    customDomainMap: CUSTOM_DOMAIN_MAP,
  }),
  publicArchivesRouter: createDefaultPublicArchivesRouter(),
  publicHomeRouter: createDefaultPublicHomeRouter(),
  publicMustReadRouter: createDefaultPublicMustReadRouter(),
  archivesSearchRouter: createDefaultArchivesSearchRouter(),
  publicSourcesRouter: createDefaultPublicSourcesRouter(),
  adminArchivesRouter: createDefaultAdminArchivesRouter(),
  adminRunsRouter: createDefaultAdminRunsRouter(),
  adminEvalRouter: createDefaultAdminEvalRouter(),
  adminSocialCredentialsRouter: createDefaultAdminSocialCredentialsRouter(),
  adminMustReadRouter: createDefaultAdminMustReadRouter(),
  runsRouter: createDefaultRunsRouter(),
  settingsRouter: createDefaultSettingsRouter(),
  sendingDomainRouter: createSendingDomainRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
    getResendClient: () => new Resend(process.env.RESEND_API_KEY),
    getResendFullAccessKey: () => process.env.RESEND_FULL_ACCESS_KEY ?? process.env.RESEND_API_KEY,
  }),
  collectorHealthRouter: createDefaultCollectorHealthRouter(),
  sourcesAdminRouter: createDefaultSourcesAdminRouter(),
  onboardingRouter: createOnboardingRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
    generatePrompts: async (blurb: string) => {
      // TODO(P11): real Anthropic-powered prompt generation
      logger.warn({ blurb }, "generatePrompts placeholder called");
      return {
        ranking: `Ranking prompt: prioritize content about ${blurb}`,
        shortlist: `Shortlist prompt: select items relevant to ${blurb}`,
      };
    },
    discoverSources: async (blurb: string) => {
      // TODO(P11): real LLM + Tavily source discovery
      logger.warn({ blurb }, "discoverSources placeholder called");
      return [];
    },
    onActivate: () => Promise.resolve(),
  }),
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
  requireAdminFactory: requireAuth,
  subscribeRouter,
  webhooksRouter,
  analyticsRouter: createDefaultAnalyticsRouter(),
  analyticsConfigRouter: createDefaultAnalyticsConfigRouter(),
  linkedInOAuthRouter: createLinkedInOAuthRouter(linkedInOAuthDeps),
  linkedInOAuthCallbackRouter: createLinkedInOAuthCallbackRouter(linkedInOAuthDeps),
  twitterOAuthRouter: createTwitterOAuthRouter(twitterOAuthDeps),
  twitterOAuthCallbackRouter: createTwitterOAuthCallbackRouter(twitterOAuthDeps),
  superAppCredentialsRouter: createSuperAppCredentialsRouter({
    getRepo: () => createAppCredentialsRepo(getDb(), getCredentialCipher()),
  }),
  superAdminRouter: createSuperAdminRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
  }),
  publicLogoRouter: createLogoRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
  }),
  notificationsRouter: createNotificationsRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
    getCipher: () => getCredentialCipher(),
  }),
  featuresRouter: createFeaturesRouter({
    getTenantsRepo: () => createTenantsRepo(getDb()),
  }),
});

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});

const shutdown = () => { void shutdownAnalytics().then(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const onFatal = (label: string) => (err: unknown) => {
  void (async () => {
    await captureException(err, { fatal: true, source: label });
    await Promise.race([
      shutdownAnalytics(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    process.exit(1);
  })();
};
process.on("uncaughtException", onFatal("uncaughtException"));
process.on("unhandledRejection", onFatal("unhandledRejection"));
