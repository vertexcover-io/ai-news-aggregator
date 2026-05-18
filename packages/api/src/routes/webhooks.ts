import { Hono } from "hono";
import type { SnsMessage } from "@api/lib/sns-verifier.js";
import type { SesEventsRepo } from "@api/repositories/ses-events.js";
import type { EmailSendsRepo } from "@api/repositories/email-sends.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
import type { createLogger } from "@newsletter/shared";
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

    await deps.sesEventsRepo.upsert({
      messageId,
      eventType,
      subscriberId,
      rawPayload: inner as unknown as Record<string, unknown>,
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
      await deps.subscribersRepo.updateStatus(subscriberId, "bounced");
      deps.logger.info({ subscriberId }, "Subscriber marked bounced");
    }

    if (inner.notificationType === "Complaint" && subscriberId) {
      await deps.subscribersRepo.updateStatus(subscriberId, "complained");
      deps.logger.info({ subscriberId }, "Subscriber marked complained");
    }

    return c.json({ ok: true });
  });

  return app;
}
