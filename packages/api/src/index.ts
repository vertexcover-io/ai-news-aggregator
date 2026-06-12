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
import { createDefaultAdminSocialCredentialsRouter } from "@api/routes/admin-social-credentials.js";
import {
  createLinkedInOAuthRouter,
  createLinkedInOAuthCallbackRouter,
} from "@api/routes/linkedin-oauth.js";
import { TwitterApi } from "twitter-api-v2";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
} from "@api/routes/twitter-oauth.js";
import {
  createTwitterOAuthService,
  type TwitterApiCtorLike,
  type TwitterOAuthAppCreds,
} from "@api/services/twitter-oauth.js";
import { createSendingDomainsRepo } from "@api/repositories/sending-domains.js";
import { createDefaultResendDomainsClient } from "@api/lib/email/resend-domains.js";
import { createSendingDomainRouter } from "@api/routes/sending-domains.js";
import {
  createTenantConfigRouter,
  createTenantLogoRouter,
} from "@api/routes/tenant-config.js";
import { createBrandingRouter } from "@api/routes/branding.js";
import { createSocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import { createSocialTokensRepo } from "@api/repositories/social-tokens.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createDefaultAdminMustReadRouter } from "@api/routes/admin-must-read.js";
import { createOnboardingRouter } from "@api/routes/onboarding.js";
import { createDefaultPromptGeneration } from "@api/services/prompt-generation.js";
import { createSourcesRepo } from "@api/repositories/sources.js";
import { createDefaultSuperAdminRouter } from "@api/routes/super-admin.js";
import { createDefaultSourcesAdminRouter } from "@api/routes/sources-admin.js";
import { createAuthRouter, AUTH_RATE_LIMITS } from "@api/routes/auth.js";
import { createUsersRepo } from "@api/repositories/users.js";
import { createPasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";
import { createRateLimiter } from "@api/lib/rate-limit.js";
import { requireUser } from "@api/auth/middleware.js";
import { buildApp } from "@api/app.js";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import {
  createSubscribersRepo,
  createSubscriberTenantLookup,
} from "@api/repositories/subscribers.js";
import { createFeedbackEventsRepo } from "@api/repositories/feedback-events.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createPublicTenantMiddleware } from "@api/middleware/tenant-host.js";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { createEmailProvider } from "@api/lib/email/provider.js";
import { renderConfirmation } from "@api/lib/email/templates/index.js";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import { createDefaultAnalyticsRouter } from "@api/routes/analytics.js";
import { createDefaultAnalyticsConfigRouter } from "@api/routes/analytics-config.js";
import { createSesEventsRepo } from "@api/repositories/ses-events.js";
import { createEmailSendTenantLookup } from "@api/repositories/email-sends.js";
import { verifySnsMessage } from "@api/lib/sns-verifier.js";
import { resolveBaseUrls } from "@api/lib/base-urls.js";
import {
  reconcileSchedulesForActiveTenants,
  removeLegacySchedulers,
} from "@api/services/scheduler.js";
import { captureException, configurePostHog, shutdownAnalytics } from "@api/lib/posthog.js";

const logger = createLogger("api");

// Route table:
//
// Public (no middleware):
//   GET  /api/archives              — listing
//   GET  /api/archives/:runId       — single archive read
//   POST /api/auth/signup | /login | /logout | /forgot-password | /reset-password
//
// Session-gated (requireUser):
//   GET  /api/auth/me
//   ALL  /api/admin/*
//   ALL  /api/runs/*
//   GET/PUT /api/settings

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
// Shared Redis connection for auth rate limiting (INCR/EXPIRE).
const authRedis = createRedisConnection();
// X-Forwarded-For is only honored for rate-limit keying when explicitly told
// how many reverse proxies sit in front of the API (deploy sets this to 1+);
// otherwise the header is client-spoofable and limits would be bypassable.
const trustProxyHopsRaw = Number(process.env.TRUST_PROXY_HOPS ?? "0");
const trustProxyHops =
  Number.isInteger(trustProxyHopsRaw) && trustProxyHopsRaw > 0
    ? trustProxyHopsRaw
    : 0;

await removeLegacySchedulers({ processingQueue, collectorHealthQueue });
await reconcileSchedulesForActiveTenants({
  processingQueue,
  collectorHealthQueue,
  listActiveTenants: () => createTenantsRepo(getDb()).listActive(),
  getSettings: (tenantId) => createUserSettingsRepo(getDb(), tenantId).get(),
});

configurePostHog(async (tenantId) =>
  createUserSettingsRepo(getDb(), tenantId).get(),
);

// Slack notifications stay tenant-0 until Phase 9 (per-tenant notifications).
const slackNotifier = createSlackNotifier({
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  archives: createRunArchivesRepo(getDb(), TENANT_ZERO_ID),
  resolveTopRankedTitle: () => Promise.resolve(null),
  logger: createLogger("slack"),
  publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
});

const appRootDomain = process.env.APP_ROOT_DOMAIN ?? "lvh.me";
const publicTenantMiddleware = createPublicTenantMiddleware({
  getTenantsRepo: () => createTenantsRepo(getDb()),
  appHost: process.env.APP_HOST ?? `app.${appRootDomain}`,
  rootDomain: appRootDomain,
  tenant0Domain: process.env.TENANT0_CUSTOM_DOMAIN,
  allowDevHeader: process.env.NODE_ENV !== "production",
});

const subscribeRouter = createSubscribeRouter({
  getSubscribersRepo: (tenantId) => createSubscribersRepo(getDb(), tenantId),
  subscriberLookup: createSubscriberTenantLookup(getDb()),
  getFeedbackEventsRepo: (tenantId) => createFeedbackEventsRepo(getDb(), tenantId),
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
  sendNewsletterToSubscriber: async (runId, subscriberId, tenantId) => {
    await processingQueue.add(
      "email-send",
      { runId, subscriberIds: [subscriberId], tenantId },
      { jobId: `email-send-${runId}-${subscriberId}` },
    );
  },
  getMostRecentReviewedArchiveId: async (tenantId) => {
    const archive = await createRunArchivesRepo(getDb(), tenantId)
      .findMostRecentReviewed();
    return archive?.id ?? null;
  },
  slackNotifier,
});

const webhooksRouter = createWebhooksRouter({
  getSesEventsRepo: (tenantId) => createSesEventsRepo(getDb(), tenantId),
  emailSendLookup: createEmailSendTenantLookup(getDb()),
  getSubscribersRepo: (tenantId) => createSubscribersRepo(getDb(), tenantId),
  verifySns: verifySnsMessage,
  slackNotifier,
  logger,
});

const authRouter = createAuthRouter({
  sessionSecret,
  getUsersRepo: () => createUsersRepo(getDb()),
  getResetTokensRepo: () => createPasswordResetTokensRepo(getDb()),
  emailProvider,
  fromEmail: fromMail,
  webBaseUrl: newsletterBaseUrl,
  logger: {
    info: (m, meta) => {
      logger.info(meta ?? {}, m);
    },
    warn: (m, meta) => {
      logger.warn(meta ?? {}, m);
    },
  },
  limiters: {
    signup: createRateLimiter({
      redis: authRedis,
      ...AUTH_RATE_LIMITS.signup,
      prefix: "rate-limit",
      trustProxyHops,
    }),
    login: createRateLimiter({
      redis: authRedis,
      ...AUTH_RATE_LIMITS.login,
      prefix: "rate-limit",
      trustProxyHops,
    }),
    forgotPassword: createRateLimiter({
      redis: authRedis,
      ...AUTH_RATE_LIMITS.forgotPassword,
      prefix: "rate-limit",
      trustProxyHops,
    }),
    resetPassword: createRateLimiter({
      redis: authRedis,
      ...AUTH_RATE_LIMITS.resetPassword,
      prefix: "rate-limit",
      trustProxyHops,
    }),
  },
});

const linkedInOAuthDeps = {
  getCredRepo: (tenantId: string) =>
    createSocialCredentialsRepo(getDb(), tenantId, getCredentialCipher()),
  getTokenRepo: (tenantId: string) =>
    createSocialTokensRepo(getDb(), tenantId, getCredentialCipher()),
  redis: oauthRedis,
  env: process.env,
};

const twitterOAuthDeps = {
  getTokenRepo: (tenantId: string) =>
    createSocialTokensRepo(getDb(), tenantId, getCredentialCipher()),
  redis: oauthRedis,
  env: process.env,
  oauthServiceFactory: (creds: TwitterOAuthAppCreds) =>
    createTwitterOAuthService(creds, {
      TwitterApiCtor: TwitterApi as TwitterApiCtorLike,
    }),
};

// Full-access RESEND_API_KEY required for domain management; unset ⇒ the
// sending-domain register/verify routes return 503.
const resendDomains = process.env.RESEND_API_KEY
  ? createDefaultResendDomainsClient(process.env.RESEND_API_KEY)
  : null;

const app = buildApp({
  sessionSecret,
  publicTenantMiddleware,
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
  adminSourcesRouter: createDefaultSourcesAdminRouter(),
  runsRouter: createDefaultRunsRouter(),
  settingsRouter: createDefaultSettingsRouter(),
  collectorHealthRouter: createDefaultCollectorHealthRouter(),
  authRouter,
  requireUserFactory: requireUser,
  subscribeRouter,
  webhooksRouter,
  analyticsRouter: createDefaultAnalyticsRouter(),
  analyticsConfigRouter: createDefaultAnalyticsConfigRouter(),
  linkedInOAuthRouter: createLinkedInOAuthRouter(linkedInOAuthDeps),
  linkedInOAuthCallbackRouter: createLinkedInOAuthCallbackRouter(linkedInOAuthDeps),
  twitterOAuthRouter: createTwitterOAuthRouter(twitterOAuthDeps),
  twitterOAuthCallbackRouter: createTwitterOAuthCallbackRouter(twitterOAuthDeps),
  sendingDomainRouter: createSendingDomainRouter({
    getSendingDomainsRepo: (tenantId) => createSendingDomainsRepo(getDb(), tenantId),
    resendDomains,
  }),
  publicTenantConfigRouter: createTenantConfigRouter({
    tenantsRepo: createTenantsRepo(getDb()),
  }),
  publicTenantLogoRouter: createTenantLogoRouter({
    tenantsRepo: createTenantsRepo(getDb()),
  }),
  adminBrandingRouter: createBrandingRouter({
    tenantsRepo: createTenantsRepo(getDb()),
  }),
  onboardingRouter: createOnboardingRouter({
    tenantsRepo: createTenantsRepo(getDb()),
    getSettingsRepo: (tenantId) => createUserSettingsRepo(getDb(), tenantId),
    getSourcesRepo: (tenantId) => createSourcesRepo(getDb(), tenantId),
    promptGeneration: createDefaultPromptGeneration({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }),
    processingQueue,
    collectorHealthQueue,
  }),
  superAdminRouter: createDefaultSuperAdminRouter(sessionSecret),
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
