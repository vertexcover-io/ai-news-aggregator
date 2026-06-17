import { config } from "dotenv";
config({ path: "../../.env" });

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}

import { serve } from "@hono/node-server";
import { createLogger, getDb, createSlackNotifier } from "@newsletter/shared";
import { systemScope } from "@newsletter/shared/types/tenant-context";
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
import { createDefaultBrandingRouter } from "@api/routes/branding.js";
import { createDefaultPublicSourcesRouter } from "@api/routes/sources.js";
import { createDefaultTenantSourcesRouter } from "@api/routes/tenant-sources.js";
import { createDefaultSettingsRouter } from "@api/routes/settings.js";
import { createDefaultSendingDomainRouter } from "@api/routes/sending-domain.js";
import { createDefaultNotificationSettingsRouter } from "@api/routes/notification-settings.js";
import { createDefaultBrandingSettingsRouter } from "@api/routes/branding-settings.js";
import { createDefaultCollectorHealthRouter } from "@api/routes/collector-health.js";
import { createDefaultAdminSocialCredentialsRouter } from "@api/routes/admin-social-credentials.js";
import {
  createLinkedInOAuthRouter,
  createLinkedInOAuthCallbackRouter,
} from "@api/routes/linkedin-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
} from "@api/routes/twitter-oauth.js";
import { createSocialTokensRepo } from "@api/repositories/social-tokens.js";
import { createAppCredentialsRepo } from "@api/repositories/app-credentials.js";
import { createSuperAppCredentialsRouter } from "@api/routes/super-app-credentials.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { createDefaultAdminMustReadRouter } from "@api/routes/admin-must-read.js";
import { createAuthRouter } from "@api/routes/auth.js";
import { createDefaultOnboardingRouter } from "@api/routes/onboarding.js";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { createUsersRepo } from "@api/repositories/users.js";
import { createTenantsRepo } from "@api/repositories/tenants.js";
import { createAuditLogRepo } from "@api/repositories/audit-log.js";
import { seedAdminUser } from "@api/services/admin-seed.js";
import type { ResetTokenStore } from "@api/services/auth.js";
import { requireAuth } from "@api/auth/middleware.js";
import { loadDomainConfig } from "@api/config/domains.js";
import { createResolveTenant } from "@api/middleware/resolve-tenant.js";
import { createRateLimiter } from "@api/auth/rate-limit.js";
import { buildApp } from "@api/app.js";
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

const logger = createLogger("api");

// Route table (P3 — per-user auth):
//
// Public (no middleware):
//   GET  /api/archives              — listing
//   GET  /api/archives/:runId       — single archive read
//   POST /api/auth/signup|login|logout|forgot|reset — session lifecycle
//   GET  /api/auth/me               — session introspection (cookie-checked)
//
// Auth-gated (requireAuth — {userId,tenantId,role} session cookie):
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

// Default-tenant bridge: sessionless write paths (public subscribe, LinkedIn
// OAuth callback) must still stamp a concrete tenant_id — resolve the
// AGENTLOOP tenant once at bootstrap. Pipeline jobs carry their own tenantId
// since P9; this scope also stamps the bootstrap scheduler reconcile below.
const defaultTenant = await createTenantsRepo(getDb()).findBySlug("agentloop");
const defaultTenantScope = defaultTenant
  ? ({ tenantId: defaultTenant.id, role: "tenant_admin" } as const)
  : undefined;
if (!defaultTenantScope) {
  logger.warn(
    "no agentloop tenant found — sessionless tenant-owned writes will fail until it exists",
  );
}

// Scoped to the AGENTLOOP bridge tenant: since 0041 dropped the singleton
// unique, an UNSCOPED get() ("WHERE singleton = true LIMIT 1") returns an
// arbitrary tenant's row once a second tenant activates — which would stamp
// AGENTLOOP's scheduler entries with another tenant's times.
const settingsRepoForBootstrap = createUserSettingsRepo(getDb(), defaultTenantScope);
await removeLegacySchedulers(processingQueue);
const settingsForBootstrap = await settingsRepoForBootstrap.get();
if (settingsForBootstrap !== null) {
  // P9 (REQ-060): bootstrap reconcile owns the legacy AGENTLOOP schedule —
  // stamp its tenant onto the scheduler entries' job data.
  await reconcilePipelineSchedule(
    processingQueue,
    settingsForBootstrap,
    defaultTenantScope?.tenantId,
  );
  await reconcileCollectorHealthSchedule(
    collectorHealthQueue,
    settingsForBootstrap,
    defaultTenantScope?.tenantId,
  );
}

// Seed the legacy single admin as a real user on a fresh DB so the dashboard
// stays reachable after the shared-password gate removal (P3). No-op when any
// user already exists (e.g. after the P2 AGENTLOOP backfill).
const adminSeedPassword = process.env.ADMIN_PASSWORD;
if (adminSeedPassword) {
  const seeded = await seedAdminUser(
    {
      usersRepo: createUsersRepo(getDb()),
      tenantsRepo: createTenantsRepo(getDb()),
    },
    {
      email: process.env.ADMIN_EMAIL ?? "admin@agentloop.dev",
      password: adminSeedPassword,
    },
  );
  if (seeded) logger.info("seeded bootstrap admin user");
}

const runArchivesRepoForSubscribe = createRunArchivesRepo(
  getDb(),
  defaultTenantScope,
);
// PostHog analytics config is the platform's (AGENTLOOP) settings row — an
// unscoped get() would read an arbitrary tenant's row (see bootstrap note).
configurePostHog(async () => createUserSettingsRepo(getDb(), defaultTenantScope).get());

const slackNotifier = createSlackNotifier({
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  archives: runArchivesRepoForSubscribe,
  resolveTopRankedTitle: () => Promise.resolve(null),
  logger: createLogger("slack"),
  publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
});

const subscribeRouter = createSubscribeRouter({
  // REQ-050/051: the route derives the fence per request — Host tenant for
  // intake, systemScope for token-verified id flows — so the factory passes
  // the scope straight through (defaultTenantScope only bridges the app host).
  getSubscribersRepo: (scope) => createSubscribersRepo(getDb(), scope),
  getFeedbackEventsRepo: (scope) => createFeedbackEventsRepo(getDb(), scope),
  defaultTenantScope,
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
      {
        runId,
        subscriberIds: [subscriberId],
        ...(tenantId !== undefined ? { tenantId } : {}),
      },
      { jobId: `email-send-${runId}-${subscriberId}` },
    );
  },
  getMostRecentReviewedArchiveId: async (tenantId) => {
    const repo =
      tenantId !== undefined
        ? createRunArchivesRepo(getDb(), { tenantId, role: "tenant_admin" })
        : runArchivesRepoForSubscribe;
    const archive = await repo.findMostRecentReviewed();
    return archive?.id ?? null;
  },
  slackNotifier,
});

// SNS webhook repos run under systemScope(): the endpoint is unauthenticated
// (no session/tenant) but trusted — handlers only reach these repos after AWS
// SNS signature verification in webhooks.ts — and a bounce/complaint for one
// email address may legitimately match email sends/subscribers across
// tenants, so the lookup and status update are cross-tenant by design.
const webhookScope = systemScope();
const webhooksRouter = createWebhooksRouter({
  sesEventsRepo: createSesEventsRepo(getDb(), webhookScope),
  emailSendsRepo: createEmailSendsRepo(getDb(), webhookScope),
  subscribersRepo: createSubscribersRepo(getDb(), webhookScope),
  verifySns: verifySnsMessage,
  slackNotifier,
  logger,
});

const linkedInOAuthDeps = {
  // The shared LinkedIn app client is APP-LEVEL (P12, REQ-080/082): resolved
  // from app_credentials, never from tenant rows.
  getAppCredsRepo: () => createAppCredentialsRepo(getDb(), getCredentialCipher()),
  // Tokens are tenant-scoped (REQ-080): /start derives the scope from the
  // session and carries the tenant id through the Redis state to the
  // session-less callback; legacy "1" states fall back to the bridge tenant.
  getTokenRepo: (scope?: TenantScope) =>
    createSocialTokensRepo(getDb(), getCredentialCipher(), scope ?? defaultTenantScope),
  redis: oauthRedis,
  env: process.env,
};

// P13 (REQ-081): per-tenant Twitter OAuth2 connect — same two-tier wiring as
// LinkedIn above (shared app client from app_credentials; tenant-scoped tokens).
const twitterOAuthDeps = {
  getAppCredsRepo: () => createAppCredentialsRepo(getDb(), getCredentialCipher()),
  getTokenRepo: (scope?: TenantScope) =>
    createSocialTokensRepo(getDb(), getCredentialCipher(), scope ?? defaultTenantScope),
  redis: oauthRedis,
  env: process.env,
};

// Single-use, short-TTL reset tokens stored in Redis (REQ-004). GETDEL makes
// consumption atomic — a token can never be redeemed twice.
const resetTokenStore: ResetTokenStore = {
  async save(tokenHash, userId, ttlSeconds) {
    await oauthRedis.set(`auth:reset:${tokenHash}`, userId, "EX", ttlSeconds);
  },
  async consume(tokenHash) {
    return oauthRedis.getdel(`auth:reset:${tokenHash}`);
  },
};

// Token-bucket limits for auth routes (REQ-121). Env-tunable so the hermetic
// e2e stack (dozens of serial logins from one IP) can relax them; production
// keeps the strict defaults.
const authRateLimiter = createRateLimiter({
  capacity: Number(process.env.AUTH_RATE_LIMIT_CAPACITY ?? 10),
  refillPerSecond: Number(process.env.AUTH_RATE_LIMIT_REFILL_PER_SEC ?? 0.5),
});

const authRouter = createAuthRouter({
  sessionSecret,
  rateLimiter: authRateLimiter,
  getUsersRepo: () => createUsersRepo(getDb()),
  getTenantsRepo: () => createTenantsRepo(getDb()),
  resetTokenStore,
  sendResetEmail: async (email, resetUrl) => {
    await emailProvider.send({
      to: [email],
      from: fromMail,
      replyTo: replyToEmail,
      subject: "Reset your password",
      html: `<p>Someone requested a password reset for this account.</p><p><a href="${resetUrl}">Set a new password</a> (link expires in 30 minutes and can be used once).</p><p>If this wasn't you, ignore this email.</p>`,
      text: `Set a new password: ${resetUrl} (expires in 30 minutes, single use). If this wasn't you, ignore this email.`,
    });
  },
  webBaseUrl: newsletterBaseUrl,
  logger: {
    info: (m, meta) => {
      logger.info(meta ?? {}, m);
    },
    warn: (m, meta) => {
      logger.warn(meta ?? {}, m);
    },
  },
});

const app = buildApp({
  sessionSecret,
  publicArchivesRouter: createDefaultPublicArchivesRouter(),
  publicHomeRouter: createDefaultPublicHomeRouter(),
  publicMustReadRouter: createDefaultPublicMustReadRouter(),
  archivesSearchRouter: createDefaultArchivesSearchRouter(),
  publicSourcesRouter: createDefaultPublicSourcesRouter(),
  // Tenant source management (P8) — auth-gated /api/sources CRUD.
  tenantSourcesRouter: createDefaultTenantSourcesRouter(),
  adminArchivesRouter: createDefaultAdminArchivesRouter(),
  adminRunsRouter: createDefaultAdminRunsRouter(),
  adminEvalRouter: createDefaultAdminEvalRouter(),
  adminSocialCredentialsRouter: createDefaultAdminSocialCredentialsRouter(),
  adminMustReadRouter: createDefaultAdminMustReadRouter(),
  runsRouter: createDefaultRunsRouter(),
  settingsRouter: createDefaultSettingsRouter(),
  // Sending-domain verification panel (P14, REQ-084/085) — full-access
  // Resend key required for the Domains API (see services/sending-domain.ts).
  sendingDomainRouter: createDefaultSendingDomainRouter(),
  // Per-tenant notifications + feature flags (P16, REQ-092/093).
  notificationSettingsRouter: createDefaultNotificationSettingsRouter(),
  // Admin branding view/edit (FIX #1) — onboarding-captured brand in Settings.
  brandingSettingsRouter: createDefaultBrandingSettingsRouter(),
  collectorHealthRouter: createDefaultCollectorHealthRouter(),
  // Public tenant branding payload + logo bytes (P7).
  brandingRouter: createDefaultBrandingRouter(),
  authRouter,
  requireAuthFactory: requireAuth,
  subscribeRouter,
  webhooksRouter,
  analyticsRouter: createDefaultAnalyticsRouter(),
  analyticsConfigRouter: createDefaultAnalyticsConfigRouter(),
  linkedInOAuthRouter: createLinkedInOAuthRouter(linkedInOAuthDeps),
  linkedInOAuthCallbackRouter: createLinkedInOAuthCallbackRouter(linkedInOAuthDeps),
  twitterOAuthRouter: createTwitterOAuthRouter(twitterOAuthDeps),
  twitterOAuthCallbackRouter: createTwitterOAuthCallbackRouter(twitterOAuthDeps),
  // Host→tenant resolution (P5): ROOT_DOMAIN / APP_HOST / CUSTOM_DOMAIN_MAP
  // env-driven; X-Tenant-Slug + *.lvh.me dev overrides outside production.
  resolveTenant: createResolveTenant({
    config: loadDomainConfig(process.env),
    getTenantsRepo: () => createTenantsRepo(getDb()),
  }),
  // Onboarding wizard (P11) — resumable state, slug check, prompt-gen,
  // source discovery, activation. Activation reconciles the per-tenant
  // schedulers on the same queues the settings save path uses.
  onboardingRouter: createDefaultOnboardingRouter({
    processingQueue,
    collectorHealthQueue,
  }),
  // Super-admin console + audited impersonation (P6) — requireSuperAdmin
  // is applied inside the router factory.
  superAdminRouter: createSuperAdminRouter({
    sessionSecret,
    getTenantsRepo: () => createTenantsRepo(getDb()),
    getAuditLogRepo: () => createAuditLogRepo(getDb()),
  }),
  // App-level shared secrets (P12, REQ-082/086) — requireSuperAdmin is
  // applied inside the router factory.
  superAppCredentialsRouter: createSuperAppCredentialsRouter({
    sessionSecret,
    getRepo: () => createAppCredentialsRepo(getDb(), getCredentialCipher()),
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
