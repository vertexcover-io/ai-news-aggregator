import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { SnsMessage } from "@api/lib/sns-verifier.js";
import type { SesEventsRepo } from "@api/repositories/ses-events.js";
import type { EmailSendsRepo } from "@api/repositories/email-sends.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import type { SesEventInsert, SesEventSelect, EmailSendSelect, SubscriberSelect, SubscriberStatus } from "@newsletter/shared";

const SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000001";
const MESSAGE_ID = "ses-msg-abc123";

function makeEmailSend(overrides: Partial<EmailSendSelect> = {}): EmailSendSelect {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    subscriberId: SUBSCRIBER_ID,
    runArchiveId: "00000000-0000-0000-0000-000000000010",
    messageId: MESSAGE_ID,
    sentAt: new Date(),
    ...overrides,
  };
}

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: SUBSCRIBER_ID,
    email: "user@example.com",
    status: "confirmed",
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: new Date(),
    unsubscribedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSesEventSelect(insert: SesEventInsert): SesEventSelect {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    ...insert,
    createdAt: new Date(),
  };
}

function makeSnsNotification(inner: Record<string, unknown>): SnsMessage {
  return {
    Type: "Notification",
    MessageId: "sns-msg-id",
    TopicArn: "arn:aws:sns:us-east-1:123456789:ses-events",
    Message: JSON.stringify(inner),
    Timestamp: "2024-01-01T00:00:00.000Z",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    Signature: "sig==",
    SignatureVersion: "1",
  };
}

function makeInnerNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    notificationType: "Delivery",
    mail: {
      messageId: MESSAGE_ID,
      timestamp: "2024-01-01T00:00:00.000Z",
      source: "newsletter@mail.example.com",
      destination: ["user@example.com"],
    },
    ...overrides,
  };
}

interface TestDeps {
  sesEventsRepo: SesEventsRepo & { upserted: SesEventInsert[] };
  emailSendsRepo: EmailSendsRepo;
  subscribersRepo: SubscribersRepo & { statusUpdates: { id: string; status: SubscriberStatus }[] };
  verifySns: ReturnType<typeof vi.fn>;
}

function makeDeps(emailSend: EmailSendSelect | null = makeEmailSend()): TestDeps {
  const upserted: SesEventInsert[] = [];
  const statusUpdates: { id: string; status: SubscriberStatus }[] = [];

  const sesEventsRepo: SesEventsRepo & { upserted: SesEventInsert[] } = {
    upserted,
    upsert: vi.fn((insert: SesEventInsert) => {
      upserted.push(insert);
      return Promise.resolve(makeSesEventSelect(insert));
    }),
  };

  const emailSendsRepo: EmailSendsRepo = {
    create: vi.fn(),
    findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
    findByMessageId: vi.fn(() => Promise.resolve(emailSend)),
  };

  const subscribersRepo: SubscribersRepo & { statusUpdates: { id: string; status: SubscriberStatus }[] } = {
    statusUpdates,
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    create: vi.fn(),
    updateConfirmToken: vi.fn(() => Promise.resolve()),
    updateStatus: vi.fn((id: string, status: SubscriberStatus) => {
      statusUpdates.push({ id, status });
      return Promise.resolve(makeSubscriber({ id, status }));
    }),
    listConfirmed: vi.fn(),
  };

  const verifySns = vi.fn();

  return { sesEventsRepo, emailSendsRepo, subscribersRepo, verifySns };
}

function buildApp(deps: TestDeps): Hono {
  const app = new Hono();
  app.route("/webhooks", createWebhooksRouter({
    sesEventsRepo: deps.sesEventsRepo,
    emailSendsRepo: deps.emailSendsRepo,
    subscribersRepo: deps.subscribersRepo,
    verifySns: deps.verifySns,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      level: "info",
    } as unknown as ReturnType<typeof import("@newsletter/shared").createLogger>,
  }));
  return app;
}

async function postSes(app: Hono, body: string): Promise<Response> {
  return app.request("/webhooks/ses", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

describe("POST /webhooks/ses", () => {
  describe("signature verification", () => {
    it("returns 400 when verifySns rejects", async () => {
      const deps = makeDeps();
      deps.verifySns.mockRejectedValue(new Error("bad signature"));
      const app = buildApp(deps);

      const res = await postSes(app, "invalid body");

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain("Invalid SNS signature");
    });
  });

  describe("SubscriptionConfirmation", () => {
    it("fetches SubscribeURL and returns 200", async () => {
      const deps = makeDeps();
      const subscribeUrl = "https://sns.us-east-1.amazonaws.com/confirm?token=xyz";
      const confirmMsg: SnsMessage = {
        Type: "SubscriptionConfirmation",
        MessageId: "sns-id",
        TopicArn: "arn:aws:sns:us-east-1:123:Topic",
        Message: "You have chosen to subscribe.",
        Timestamp: "2024-01-01T00:00:00.000Z",
        SubscribeURL: subscribeUrl,
        Token: "long-token",
        SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
        Signature: "sig==",
        SignatureVersion: "1",
      } as unknown as SnsMessage;

      deps.verifySns.mockResolvedValue(confirmMsg);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const app = buildApp(deps);
      const res = await postSes(app, JSON.stringify(confirmMsg));

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(subscribeUrl);

      vi.unstubAllGlobals();
    });
  });

  describe("Bounce notification", () => {
    it("permanent bounce: upserts ses_events and marks subscriber bounced", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({
        notificationType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ emailAddress: "user@example.com" }],
        },
      });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted).toHaveLength(1);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("bounce");
      expect(deps.subscribersRepo.statusUpdates).toHaveLength(1);
      expect(deps.subscribersRepo.statusUpdates[0]).toEqual({ id: SUBSCRIBER_ID, status: "bounced" });
    });

    it("transient bounce: upserts ses_events but does NOT mark subscriber bounced", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({
        notificationType: "Bounce",
        bounce: {
          bounceType: "Transient",
          bounceSubType: "MailboxFull",
          bouncedRecipients: [{ emailAddress: "user@example.com" }],
        },
      });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted).toHaveLength(1);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("bounce");
      expect(deps.subscribersRepo.statusUpdates).toHaveLength(0);
    });
  });

  describe("Complaint notification", () => {
    it("upserts ses_events and marks subscriber complained", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({
        notificationType: "Complaint",
        complaint: { complainedRecipients: [{ emailAddress: "user@example.com" }] },
      });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("complaint");
      expect(deps.subscribersRepo.statusUpdates[0]).toEqual({ id: SUBSCRIBER_ID, status: "complained" });
    });
  });

  describe("Delivery notification", () => {
    it("upserts ses_events and does not update subscriber status", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({ notificationType: "Delivery" });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("delivery");
      expect(deps.subscribersRepo.statusUpdates).toHaveLength(0);
    });
  });

  describe("Open notification", () => {
    it("upserts ses_events with eventType=open", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({
        notificationType: "Open",
        open: { timestamp: "2024-01-01T00:00:00.000Z", userAgent: "Mozilla/5.0", ipAddress: "1.2.3.4" },
      });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("open");
    });
  });

  describe("Click notification", () => {
    it("upserts ses_events with eventType=click", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({
        notificationType: "Click",
        click: { timestamp: "2024-01-01T00:00:00.000Z", link: "https://example.com/article" },
      });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted[0].eventType).toBe("click");
    });
  });

  describe("unknown messageId", () => {
    it("creates ses_events with subscriberId=null and no subscriber update", async () => {
      const deps = makeDeps(null);
      const inner = makeInnerNotification({ notificationType: "Delivery" });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBe(200);
      expect(deps.sesEventsRepo.upserted[0].subscriberId).toBeNull();
      expect(deps.subscribersRepo.statusUpdates).toHaveLength(0);
    });
  });

  describe("duplicate event", () => {
    it("returns 200 even when upsert is called again for same messageId+eventType", async () => {
      const deps = makeDeps();
      const inner = makeInnerNotification({ notificationType: "Delivery" });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      // Simulate upsert not throwing on conflict (idempotent)
      const app = buildApp(deps);

      const res1 = await postSes(app, JSON.stringify(makeSnsNotification(inner)));
      const res2 = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(deps.sesEventsRepo.upserted).toHaveLength(2);
    });
  });
});
