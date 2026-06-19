import { Hono } from "hono";
import type { SnsMessage } from "@api/lib/sns-verifier.js";
import type { SesEventsRepo } from "@api/repositories/ses-events.js";
import type { EmailSendsRepo } from "@api/repositories/email-sends.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
import type { createLogger, SlackNotifier } from "@newsletter/shared";
import type { SesEventType } from "@newsletter/shared";
import { captureAnalytics } from "@api/lib/posthog.js";

type Logger = ReturnType<typeof createLogger>;

interface SesInnerNotification {
  notificationType: "Bounce" | "Complaint" | "Delivery" | "Open" | "Click";
  mail: {
    messageId: string;
    timestamp: string;
    source: string;
    destination: string[];
  };
  bounce?: {
    bounceType: "Permanent" | "Transient" | "Undetermined";
    bounceSubType: string;
    bouncedRecipients: { emailAddress: string }[];
  };
  complaint?: {
    complainedRecipients: { emailAddress: string }[];
  };
  open?: {
    timestamp: string;
    userAgent: string;
    ipAddress: string;
  };
  click?: {
    timestamp: string;
    link: string;
  };
}

export interface WebhooksRouterDeps {
  sesEventsRepo: SesEventsRepo;
  emailSendsRepo: EmailSendsRepo;
  subscribersRepo: SubscribersRepo;
  verifySns: (rawBody: string) => Promise<SnsMessage>;
  slackNotifier: SlackNotifier;
  logger: Logger;
}

export function createWebhooksRouter(deps: WebhooksRouterDeps): Hono {
  const app = new Hono();

  app.post("/ses", async (c) => {
    const rawBody = await c.req.text();

    let message: SnsMessage;
    try {
      message = await deps.verifySns(rawBody);
    } catch (err) {
      deps.logger.warn({ err }, "SNS signature verification failed");
      return c.json({ error: "Invalid SNS signature" }, 400);
    }

    if (message.Type === "SubscriptionConfirmation") {
      if (message.SubscribeURL) {
        await fetch(message.SubscribeURL);
        deps.logger.info({ topicArn: message.TopicArn }, "SNS subscription confirmed");
      }
      return c.json({ ok: true });
    }

    if (message.Type !== "Notification") {
      return c.json({ ok: true });
    }

    let inner: SesInnerNotification;
    try {
      inner = JSON.parse(message.Message) as SesInnerNotification;
    } catch {
      deps.logger.warn({ messageId: message.MessageId }, "Failed to parse SES inner notification");
      return c.json({ ok: true });
    }

    const messageId = inner.mail.messageId;
    const emailSend = await deps.emailSendsRepo.findByMessageId(messageId);
    const subscriberId = emailSend?.subscriberId ?? null;

    const eventTypeMap: Record<SesInnerNotification["notificationType"], SesEventType> = {
      Bounce: "bounce",
      Complaint: "complaint",
      Delivery: "delivery",
      Open: "open",
      Click: "click",
    };

    const eventType = eventTypeMap[inner.notificationType];

    // The webhook runs under systemScope() (cross-tenant), so the repo cannot
    // stamp tenant_id from scope — stamp it from the matched email send. An
    // unmatched message has no tenant to attribute the event to (and no
    // subscriber to act on), so it is logged and skipped.
    const tenantId = emailSend?.tenantId ?? null;
    if (tenantId === null) {
      deps.logger.warn(
        { messageId, eventType },
        "SES event without matching email send — skipping (no tenant to attribute)",
      );
      return c.json({ ok: true });
    }

    await deps.sesEventsRepo.upsert({
      messageId,
      eventType,
      subscriberId,
      tenantId,
      rawPayload: { ...inner } as Record<string, unknown>,
      occurredAt: new Date(inner.mail.timestamp),
    });

    deps.logger.info({ messageId, eventType, subscriberId }, "SES event recorded");

    if (inner.notificationType === "Delivery" && subscriberId) {
      void captureAnalytics({
        distinctId: subscriberId,
        event: "email_delivered",
        properties: { message_id: messageId },
      });
    }

    if (inner.notificationType === "Open" && subscriberId) {
      void captureAnalytics({
        distinctId: subscriberId,
        event: "email_opened",
        properties: { message_id: messageId },
      });
    }

    if (inner.notificationType === "Bounce" && inner.bounce?.bounceType === "Permanent" && subscriberId) {
      const { changed: bounceChanged, next: bounceNext, row: bounceRow } =
        await deps.subscribersRepo.updateStatus(subscriberId, "bounced");
      deps.logger.info({ subscriberId }, "Subscriber marked bounced");
      if (bounceChanged && bounceNext === "bounced") {
        const totalConfirmed = await deps.subscribersRepo.countConfirmed();
        void deps.slackNotifier
          .notifySubscriberRemoved({ email: bounceRow.email, via: "bounce", totalConfirmed })
          .catch((err: unknown) => {
            deps.logger.warn(
              {
                event: "slack.subscriber_removed.unexpected_throw",
                error: err instanceof Error ? err.message : String(err),
              },
              "slack: unexpected throw from notifySubscriberRemoved (bounce)",
            );
          });
      }
    }

    if (inner.notificationType === "Complaint" && subscriberId) {
      const { changed: complaintChanged, next: complaintNext, row: complaintRow } =
        await deps.subscribersRepo.updateStatus(subscriberId, "complained");
      deps.logger.info({ subscriberId }, "Subscriber marked complained");
      if (complaintChanged && complaintNext === "complained") {
        const totalConfirmed = await deps.subscribersRepo.countConfirmed();
        void deps.slackNotifier
          .notifySubscriberRemoved({ email: complaintRow.email, via: "complaint", totalConfirmed })
          .catch((err: unknown) => {
            deps.logger.warn(
              {
                event: "slack.subscriber_removed.unexpected_throw",
                error: err instanceof Error ? err.message : String(err),
              },
              "slack: unexpected throw from notifySubscriberRemoved (complaint)",
            );
          });
      }
    }

    return c.json({ ok: true });
  });

  return app;
}
