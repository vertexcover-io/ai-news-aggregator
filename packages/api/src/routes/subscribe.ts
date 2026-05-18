import { Hono } from "hono";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import { issueSubscriberToken, verifySubscriberToken } from "@api/lib/subscriber-token.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
import { captureAnalytics } from "@api/lib/posthog.js";

export interface SubscribeRouterDeps {
  subscribersRepo: SubscribersRepo;
  sessionSecret: string;
  baseUrl: string;
  webBaseUrl: string;
  sendConfirmationEmail: (email: string, confirmUrl: string) => Promise<void>;
  sendNewsletterToSubscriber: (runId: string, subscriberId: string) => Promise<void>;
  getMostRecentReviewedArchiveId: () => Promise<string | null>;
  logger?: ReturnType<typeof createLogger>;
}

const PG_UNIQUE_VIOLATION = "23505";
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

  app.post("/subscribe", async (c) => {
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
    const existing = await deps.subscribersRepo.findByEmail(email);
    if (existing) {
      logger.info(
        { event: "subscribe.duplicate", subscriberId: existing.id, email: masked, status: existing.status },
        "subscribe: existing subscriber, no-op",
      );
      return c.json({ ok: true });
    }

    let subscriber;
    try {
      subscriber = await deps.subscribersRepo.create({
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

    const confirmTokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS);
    const confirmToken = issueSubscriberToken(
      subscriber.id,
      "confirm",
      deps.sessionSecret,
      confirmTokenExpiresAt,
    );

    await deps.subscribersRepo.updateConfirmToken(
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

    await deps.subscribersRepo.updateStatus(result.subscriberId, "confirmed", {
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

    const recentArchiveId = await deps.getMostRecentReviewedArchiveId();
    if (recentArchiveId) {
      try {
        await deps.sendNewsletterToSubscriber(recentArchiveId, result.subscriberId);
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
      await deps.subscribersRepo.updateStatus(result.subscriberId, "unsubscribed", {
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
        await deps.subscribersRepo.updateStatus(result.subscriberId, "unsubscribed", {
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

  return app;
}
