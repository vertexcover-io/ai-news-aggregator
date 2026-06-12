import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { Hono } from "hono";
import type { SnsMessage } from "@api/lib/sns-verifier.js";
import type { SesEventsRepo } from "@api/repositories/ses-events.js";
import type { EmailSendTenantLookup } from "@api/repositories/email-sends.js";
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
  getSesEventsRepo: (tenantId: string) => SesEventsRepo;
  /** Global messageId -> email_send lookup; the row's tenantId is the tenant
   * resolution for the event (SES posts carry no tenant context). */
  emailSendLookup: EmailSendTenantLookup;
  getSubscribersRepo: (tenantId: string) => SubscribersRepo;
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
    const emailSend = await deps.emailSendLookup.findByMessageId(messageId);
    const subscriberId = emailSend?.subscriberId ?? null;
    // Unattributable events (no email_send row) land in the tenant-0
    // catch-all so the audit trail and idempotent 200 are preserved.
    const tenantId = emailSend?.tenantId ?? TENANT_ZERO_ID;
    const subscribersRepo = deps.getSubscribersRepo(tenantId);

    const eventTypeMap: Record<SesInnerNotification["notificationType"], SesEventType> = {
      Bounce: "bounce",
      Complaint: "complaint",
      Delivery: "delivery",
      Open: "open",
      Click: "click",
    };

    const eventType = eventTypeMap[inner.notificationType];

    await deps.getSesEventsRepo(tenantId).upsert({
      messageId,
      eventType,
      subscriberId,
      rawPayload: { ...inner } as Record<string, unknown>,
      occurredAt: new Date(inner.mail.timestamp),
    });

    deps.logger.info({ messageId, eventType, subscriberId }, "SES event recorded");

    if (inner.notificationType === "Delivery" && subscriberId) {
      void captureAnalytics({
        tenantId,
        distinctId: subscriberId,
        event: "email_delivered",
        properties: { message_id: messageId },
      });
    }

    if (inner.notificationType === "Open" && subscriberId) {
      void captureAnalytics({
        tenantId,
        distinctId: subscriberId,
        event: "email_opened",
        properties: { message_id: messageId },
      });
    }

    if (inner.notificationType === "Bounce" && inner.bounce?.bounceType === "Permanent" && subscriberId) {
      const { changed: bounceChanged, next: bounceNext, row: bounceRow } =
        await subscribersRepo.updateStatus(subscriberId, "bounced");
      deps.logger.info({ subscriberId }, "Subscriber marked bounced");
      if (bounceChanged && bounceNext === "bounced") {
        const totalConfirmed = await subscribersRepo.countConfirmed();
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
        await subscribersRepo.updateStatus(subscriberId, "complained");
      deps.logger.info({ subscriberId }, "Subscriber marked complained");
      if (complaintChanged && complaintNext === "complained") {
        const totalConfirmed = await subscribersRepo.countConfirmed();
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
