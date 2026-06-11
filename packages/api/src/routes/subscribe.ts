import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import type { FeedbackRating, SlackNotifier } from "@newsletter/shared";
import {
  systemScope,
  type TenantContext,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import { issueSubscriberToken, verifySubscriberToken } from "@api/lib/subscriber-token.js";
import { tenantScopeFromPublicHost } from "@api/auth/tenant-scope.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
import type { FeedbackEventsRepo } from "@api/repositories/feedback-events.js";
import { captureAnalytics } from "@api/lib/posthog.js";

const FEEDBACK_RATINGS: readonly FeedbackRating[] = ["love", "meh", "nah"];

function parseRating(value: string | undefined): FeedbackRating | null {
  return FEEDBACK_RATINGS.find((r) => r === value) ?? null;
}

export interface SubscribeRouterDeps {
  /**
   * Tenant-scoped repo factory (REQ-050/051): the INTAKE path (POST
   * /subscribe) is scoped to the Host-resolved tenant (falling back to
   * `defaultTenantScope` on the app host); the token-verified flows
   * (confirm/unsubscribe/feedback) look subscribers up by id under
   * `systemScope()` — the HMAC-signed subscriber token is the trust boundary
   * there, and the link is clicked from email on the API host where no
   * public tenant resolves — then re-fence per the subscriber's own tenant.
   */
  getSubscribersRepo: (scope?: TenantScope) => SubscribersRepo;
  getFeedbackEventsRepo: (scope?: TenantScope) => FeedbackEventsRepo;
  /** Bridge scope for hosts with no resolved tenant (app host / legacy single-tenant). */
  defaultTenantScope?: TenantScope;
  /** Campaign id stamped on every feedback event (one-time reader-feedback send). */
  feedbackCampaign: string;
  sessionSecret: string;
  baseUrl: string;
  webBaseUrl: string;
  sendConfirmationEmail: (email: string, confirmUrl: string) => Promise<void>;
  /** `tenantId` (REQ-060): stamped onto the welcome email-send job payload. */
  sendNewsletterToSubscriber: (
    runId: string,
    subscriberId: string,
    tenantId?: string,
  ) => Promise<void>;
  /** Most recent reviewed archive OF THE GIVEN TENANT (welcome back-issue). */
  getMostRecentReviewedArchiveId: (tenantId?: string) => Promise<string | null>;
  slackNotifier: SlackNotifier;
  logger?: ReturnType<typeof createLogger>;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}***@${domain}`;
}

const subscribeBodySchema = z.object({
  email: z.email().max(254),
});

export function createSubscribeRouter(deps: SubscribeRouterDeps): Hono {
  const app = new Hono();
  const logger = deps.logger ?? createLogger("api:subscribe");

  /** Intake fence (REQ-050): the Host-resolved tenant, else the bridge. */
  const intakeScope = (c: Context): TenantScope | undefined =>
    tenantScopeFromPublicHost(c) ?? deps.defaultTenantScope;

  /** Fence derived from a fetched subscriber row's own tenant (REQ-051). */
  const subscriberTenantScope = (
    tenantId: string | null,
  ): TenantScope | undefined =>
    tenantId !== null
      ? ({ tenantId, role: "tenant_admin" } satisfies TenantContext)
      : deps.defaultTenantScope;

  app.post("/subscribe", async (c) => {
    const subscribersRepo = deps.getSubscribersRepo(intakeScope(c));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ event: "subscribe.invalid_json" }, "subscribe: invalid json body");
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = subscribeBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn(
        { event: "subscribe.invalid_input", reason: parsed.error.message },
        "subscribe: validation failed",
      );
      return c.json({ error: parsed.error.message }, 400);
    }

    const { email } = parsed.data;
    const masked = maskEmail(email);
    const existing = await subscribersRepo.findByEmail(email);
    if (existing) {
      logger.info(
        { event: "subscribe.duplicate", subscriberId: existing.id, email: masked, status: existing.status },
        "subscribe: existing subscriber, no-op",
      );
      return c.json({ ok: true });
    }

    const PG_UNIQUE_VIOLATION = "23505";
    let subscriber;
    try {
      subscriber = await subscribersRepo.create({
        email,
        status: "pending",
      });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === PG_UNIQUE_VIOLATION) {
        logger.info(
          { event: "subscribe.race_won", email: masked },
          "subscribe: concurrent insert lost the race, returning idempotent ok",
        );
        return c.json({ ok: true });
      }
      logger.error(
        { event: "subscribe.create_failed", email: masked, error: err instanceof Error ? err.message : String(err) },
        "subscribe: subscriber create failed",
      );
      throw err;
    }

    logger.info(
      { event: "subscribe.created", subscriberId: subscriber.id, email: masked },
      "subscribe: new subscriber persisted (pending)",
    );
    void captureAnalytics({
      distinctId: subscriber.id,
      event: "subscriber_created",
    });

    const confirmTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const confirmToken = issueSubscriberToken(
      subscriber.id,
      "confirm",
      deps.sessionSecret,
      confirmTokenExpiresAt,
    );

    await subscribersRepo.updateConfirmToken(
      subscriber.id,
      confirmToken,
      confirmTokenExpiresAt,
    );

    const confirmUrl = `${deps.baseUrl}/api/confirm?token=${confirmToken}`;
    try {
      await deps.sendConfirmationEmail(email, confirmUrl);
      logger.info(
        { event: "subscribe.confirmation_sent", subscriberId: subscriber.id, email: masked },
        "subscribe: confirmation email sent",
      );
    } catch (err) {
      // Email send failures (provider rejection, rate limit, transient outage)
      // must not surface as 500: the subscriber is persisted in pending state
      // and can be re-sent via admin tools or retried.
      logger.warn(
        {
          event: "subscribe.confirmation_send_failed",
          subscriberId: subscriber.id,
          email: masked,
          error: err instanceof Error ? err.message : String(err),
        },
        "subscribe: confirmation email send failed (subscriber still persisted as pending)",
      );
    }

    return c.json({ ok: true });
  });

  app.get("/confirm", async (c) => {
    const token = c.req.query("token") ?? "";
    const result = verifySubscriberToken(token, "confirm", deps.sessionSecret);

    if (!result.valid) {
      logger.warn(
        { event: "confirm.invalid_token", reason: result.reason },
        "confirm: invalid/expired token",
      );
      if (result.reason === "expired") {
        return c.redirect(`${deps.webBaseUrl}/confirm?status=expired`);
      }
      if (result.reason === "wrong-type") {
        return c.redirect(`${deps.webBaseUrl}/confirm?status=invalid`);
      }
      return c.redirect(`${deps.webBaseUrl}/confirm?status=invalid`);
    }

    // Token-authenticated id lookup: cross-tenant by design (the signed
    // token is the trust boundary; the email link lands on the API host
    // where no public tenant resolves).
    const systemRepo = deps.getSubscribersRepo(systemScope());
    const { changed: confirmChanged, next: confirmNext, row: confirmRow } =
      await systemRepo.updateStatus(result.subscriberId, "confirmed", {
        subscribedAt: new Date(),
        confirmToken: null,
        confirmTokenExpiresAt: null,
      });

    logger.info(
      { event: "confirm.success", subscriberId: result.subscriberId },
      "confirm: subscriber moved pending -> confirmed",
    );
    void captureAnalytics({
      distinctId: result.subscriberId,
      event: "subscriber_confirmed",
    });

    const confirmTenantId = confirmRow.tenantId ?? undefined;
    if (confirmChanged && confirmNext === "confirmed") {
      // Tally within the subscriber's own tenant, never platform-wide.
      const totalConfirmed = await deps
        .getSubscribersRepo(subscriberTenantScope(confirmRow.tenantId))
        .countConfirmed();
      void deps.slackNotifier
        .notifySubscriberConfirmed({ email: confirmRow.email, totalConfirmed })
        .catch((err: unknown) => {
          logger.warn(
            {
              event: "slack.subscriber_confirmed.unexpected_throw",
              error: err instanceof Error ? err.message : String(err),
            },
            "slack: unexpected throw from notifySubscriberConfirmed",
          );
        });
    }

    const recentArchiveId = await deps.getMostRecentReviewedArchiveId(
      confirmTenantId,
    );
    if (recentArchiveId) {
      try {
        await deps.sendNewsletterToSubscriber(
          recentArchiveId,
          result.subscriberId,
          confirmTenantId,
        );
        logger.info(
          {
            event: "confirm.welcome_send_enqueued",
            subscriberId: result.subscriberId,
            runId: recentArchiveId,
          },
          "confirm: enqueued most recent reviewed archive to new subscriber",
        );
      } catch (err) {
        logger.warn(
          {
            event: "confirm.welcome_send_failed",
            subscriberId: result.subscriberId,
            runId: recentArchiveId,
            error: err instanceof Error ? err.message : String(err),
          },
          "confirm: failed to enqueue most recent reviewed archive",
        );
      }
    }

    return c.redirect(`${deps.webBaseUrl}/confirm?status=success`);
  });

  app.get("/unsubscribe", async (c) => {
    const token = c.req.query("token") ?? "";
    const result = verifySubscriberToken(token, "unsub", deps.sessionSecret);

    if (result.valid) {
      const { changed: unsubChanged, next: unsubNext, row: unsubRow } =
        await deps.getSubscribersRepo(systemScope()).updateStatus(result.subscriberId, "unsubscribed", {
          unsubscribedAt: new Date(),
        });
      logger.info(
        { event: "unsubscribe.success", subscriberId: result.subscriberId, via: "GET" },
        "unsubscribe: subscriber unsubscribed",
      );
      void captureAnalytics({
        distinctId: result.subscriberId,
        event: "subscriber_unsubscribed",
        properties: { via: "GET" },
      });
      if (unsubChanged && unsubNext === "unsubscribed") {
        const totalConfirmed = await deps
          .getSubscribersRepo(subscriberTenantScope(unsubRow.tenantId))
          .countConfirmed();
        void deps.slackNotifier
          .notifySubscriberRemoved({ email: unsubRow.email, via: "unsubscribe-link", totalConfirmed })
          .catch((err: unknown) => {
            logger.warn(
              {
                event: "slack.subscriber_removed.unexpected_throw",
                error: err instanceof Error ? err.message : String(err),
              },
              "slack: unexpected throw from notifySubscriberRemoved",
            );
          });
      }
    } else {
      logger.warn(
        { event: "unsubscribe.invalid_token", via: "GET", reason: result.reason },
        "unsubscribe: invalid/expired token (still returning success to prevent enumeration)",
      );
    }

    return c.redirect(`${deps.webBaseUrl}/unsubscribe?status=success`);
  });

  app.post("/unsubscribe", async (c) => {
    let token: string | undefined;

    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      const rawToken = formData.token;
      token = typeof rawToken === "string" ? rawToken : c.req.query("token");
    } else {
      try {
        const body: Record<string, unknown> = await c.req.json();
        const rawToken = body.token;
        token = typeof rawToken === "string" ? rawToken : undefined;
      } catch {
        token = undefined;
      }
    }

    if (token) {
      const result = verifySubscriberToken(token, "unsub", deps.sessionSecret);
      if (result.valid) {
        const { changed: oneClickChanged, next: oneClickNext, row: oneClickRow } =
          await deps.getSubscribersRepo(systemScope()).updateStatus(result.subscriberId, "unsubscribed", {
            unsubscribedAt: new Date(),
          });
        logger.info(
          { event: "unsubscribe.success", subscriberId: result.subscriberId, via: "POST" },
          "unsubscribe: subscriber unsubscribed (one-click)",
        );
        void captureAnalytics({
          distinctId: result.subscriberId,
          event: "subscriber_unsubscribed",
          properties: { via: "POST" },
        });
        if (oneClickChanged && oneClickNext === "unsubscribed") {
          const totalConfirmed = await deps
            .getSubscribersRepo(subscriberTenantScope(oneClickRow.tenantId))
            .countConfirmed();
          void deps.slackNotifier
            .notifySubscriberRemoved({ email: oneClickRow.email, via: "one-click", totalConfirmed })
            .catch((err: unknown) => {
              logger.warn(
                {
                  event: "slack.subscriber_removed.unexpected_throw",
                  error: err instanceof Error ? err.message : String(err),
                },
                "slack: unexpected throw from notifySubscriberRemoved",
              );
            });
        }
      } else {
        logger.warn(
          { event: "unsubscribe.invalid_token", via: "POST", reason: result.reason },
          "unsubscribe: invalid token on one-click POST",
        );
      }
    } else {
      logger.warn(
        { event: "unsubscribe.missing_token", via: "POST" },
        "unsubscribe: POST received without token",
      );
    }

    return c.json({ ok: true });
  });

  // One-tap reader feedback. Each emoji link in a feedback campaign is a signed
  // GET link; clicking it lands here, records an append-only event, and bounces
  // the reader to the web thank-you page. Slack fires only on a subscriber's
  // first tap per campaign so an email-client prefetch of all three links can't
  // spam the channel (the clean tally is derived from the event log).
  app.get("/feedback", async (c) => {
    const token = c.req.query("token") ?? "";
    const rating = parseRating(c.req.query("v"));
    const result = verifySubscriberToken(token, "feedback", deps.sessionSecret);

    if (!result.valid) {
      logger.warn(
        { event: "feedback.invalid_token", reason: result.reason },
        "feedback: invalid/expired token",
      );
      const status = result.reason === "expired" ? "expired" : "invalid";
      return c.redirect(`${deps.webBaseUrl}/feedback?status=${status}`);
    }

    if (rating === null) {
      logger.warn(
        { event: "feedback.invalid_rating", subscriberId: result.subscriberId },
        "feedback: unknown rating value",
      );
      return c.redirect(`${deps.webBaseUrl}/feedback?status=invalid`);
    }

    const subscriber = await deps
      .getSubscribersRepo(systemScope())
      .findById(result.subscriberId);
    if (!subscriber) {
      logger.warn(
        { event: "feedback.subscriber_missing", subscriberId: result.subscriberId },
        "feedback: token valid but subscriber not found",
      );
      return c.redirect(`${deps.webBaseUrl}/feedback?status=invalid`);
    }

    const feedbackEventsRepo = deps.getFeedbackEventsRepo(
      subscriberTenantScope(subscriber.tenantId),
    );
    const isFirstTap = !(await feedbackEventsRepo.hasPriorEvent(
      result.subscriberId,
      deps.feedbackCampaign,
    ));

    await feedbackEventsRepo.insertEvent({
      subscriberId: result.subscriberId,
      campaign: deps.feedbackCampaign,
      rating,
      userAgent: c.req.header("user-agent") ?? null,
      ip: c.req.header("x-forwarded-for") ?? null,
    });

    logger.info(
      { event: "feedback.recorded", subscriberId: result.subscriberId, rating, firstTap: isFirstTap },
      "feedback: rating recorded",
    );

    if (isFirstTap) {
      void deps.slackNotifier
        .notifyFeedbackReceived({ email: subscriber.email, rating })
        .catch((err: unknown) => {
          logger.warn(
            {
              event: "slack.feedback_received.unexpected_throw",
              error: err instanceof Error ? err.message : String(err),
            },
            "slack: unexpected throw from notifyFeedbackReceived",
          );
        });
    }

    return c.redirect(`${deps.webBaseUrl}/feedback?status=ok&v=${rating}`);
  });

  return app;
}
