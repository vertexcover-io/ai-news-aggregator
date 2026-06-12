import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { SnsMessage } from "@api/lib/sns-verifier.js";
import type { SesEventsRepo } from "@api/repositories/ses-events.js";
import type { EmailSendsRepo } from "@api/repositories/email-sends.js";
import type { SubscribersRepo, SubscriberStatusUpdateResult } from "@api/repositories/subscribers.js";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import type { SesEventInsert, SesEventSelect, EmailSendSelect, SubscriberSelect, SubscriberStatus, SlackNotifier } from "@newsletter/shared";

const SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000001";
const MESSAGE_ID = "ses-msg-abc123";

function makeEmailSend(overrides: Partial<EmailSendSelect> = {}): EmailSendSelect {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    tenantId: "00000000-0000-0000-0000-000000000000",
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
  slackNotifier: ReturnType<typeof makeSlackNotifier>;
}

function makeSlackNotifier() {
  return {
    notifyNewsletterSent: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyReviewPending: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyReviewWarning: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyPublishFailed: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyPublishUnavailable: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySourceDistribution: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyEmailDelivery: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyLinkedinPosted: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyTwitterPosted: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySubscriberConfirmed: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySubscriberRemoved: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyFeedbackReceived: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
  } satisfies SlackNotifier;
}

function makeDeps(opts: {
  emailSend?: EmailSendSelect | null;
  unchanged?: boolean;
  confirmedCount?: number;
} = {}): TestDeps {
  const { emailSend = makeEmailSend(), unchanged = false, confirmedCount = 2 } = opts;
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
    updateStatus: vi.fn((id: string, status: SubscriberStatus): Promise<SubscriberStatusUpdateResult> => {
      statusUpdates.push({ id, status });
      const row = makeSubscriber({ id, status });
      if (unchanged) {
        return Promise.resolve({ changed: false, next: status, row });
      }
      return Promise.resolve({ changed: true, next: status, row });
    }),
    listConfirmed: vi.fn(() => Promise.resolve([])),
    countConfirmed: vi.fn(() => Promise.resolve(confirmedCount)),
  };

  const verifySns = vi.fn();
  const slackNotifier = makeSlackNotifier();

  return { sesEventsRepo, emailSendsRepo, subscribersRepo, verifySns, slackNotifier };
}

function buildApp(deps: TestDeps): Hono {
  const app = new Hono();
  app.route("/webhooks", createWebhooksRouter({
    getSesEventsRepo: () => deps.sesEventsRepo,
    emailSendLookup: { findByMessageId: (id) => deps.emailSendsRepo.findByMessageId(id) },
    getSubscribersRepo: () => deps.subscribersRepo,
    verifySns: deps.verifySns,
    slackNotifier: deps.slackNotifier,
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

  describe("non-status-changing notifications (Delivery / Open / Click)", () => {
    it.each<{ name: string; inner: Record<string, unknown>; eventType: string }>([
      {
        name: "Delivery",
        inner: { notificationType: "Delivery" },
        eventType: "delivery",
      },
      {
        name: "Open",
        inner: {
          notificationType: "Open",
          open: {
            timestamp: "2024-01-01T00:00:00.000Z",
            userAgent: "Mozilla/5.0",
            ipAddress: "1.2.3.4",
          },
        },
        eventType: "open",
      },
      {
        name: "Click",
        inner: {
          notificationType: "Click",
          click: {
            timestamp: "2024-01-01T00:00:00.000Z",
            link: "https://example.com/article",
          },
        },
        eventType: "click",
      },
    ])(
      "$name: upserts ses_events with eventType=$eventType and no subscriber status change",
      async ({ inner, eventType }) => {
        const deps = makeDeps();
        const notification = makeSnsNotification(makeInnerNotification(inner));
        deps.verifySns.mockResolvedValue(notification);
        const app = buildApp(deps);

        const res = await postSes(app, JSON.stringify(notification));

        expect(res.status).toBe(200);
        expect(deps.sesEventsRepo.upserted[0].eventType).toBe(eventType);
        expect(deps.subscribersRepo.statusUpdates).toHaveLength(0);
      },
    );
  });

  describe("unknown messageId", () => {
    it("creates ses_events with subscriberId=null and no subscriber update", async () => {
      const deps = makeDeps({ emailSend: null });
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

  describe("ses_events persistence failure", () => {
    it("returns a non-2xx status when upsert rejects, so SES retries the delivery", async () => {
      // Real integration-point failure: the SNS signature is valid and the body
      // parses, but persisting the ses_events row throws (e.g. Postgres down).
      // The handler must NOT ack with 2xx — SES retries only on a non-2xx, so
      // swallowing this would silently drop the event.
      const deps = makeDeps();
      const inner = makeInnerNotification({ notificationType: "Delivery" });
      deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
      deps.sesEventsRepo.upsert = vi.fn(() =>
        Promise.reject(new Error("connection terminated unexpectedly")),
      );
      const app = buildApp(deps);

      const res = await postSes(app, JSON.stringify(makeSnsNotification(inner)));

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);
    });
  });
});

// ---- VS-8: Slack notification wiring for SES bounce/complaint ----

describe("VS-8: SES webhook Slack notifications", () => {
  function makePermanentBounceInner(): Record<string, unknown> {
    return makeInnerNotification({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: "user@example.com" }],
      },
    });
  }

  function makeComplaintInner(): Record<string, unknown> {
    return makeInnerNotification({
      notificationType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "user@example.com" }] },
    });
  }

  it("permanent bounce fires notifySubscriberRemoved with via:bounce", async () => {
    const deps = makeDeps({ confirmedCount: 7 });
    const { notifySubscriberRemoved } = deps.slackNotifier;
    const inner = makePermanentBounceInner();
    deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
    const app = buildApp(deps);

    await postSes(app, JSON.stringify(makeSnsNotification(inner)));
    await new Promise((r) => setTimeout(r, 0));

    expect(notifySubscriberRemoved).toHaveBeenCalledOnce();
    expect(notifySubscriberRemoved).toHaveBeenCalledWith({
      email: "user@example.com",
      via: "bounce",
      totalConfirmed: 7,
    });
  });

  it("complaint fires notifySubscriberRemoved with via:complaint", async () => {
    const deps = makeDeps({ confirmedCount: 6 });
    const { notifySubscriberRemoved } = deps.slackNotifier;
    const inner = makeComplaintInner();
    deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
    const app = buildApp(deps);

    await postSes(app, JSON.stringify(makeSnsNotification(inner)));
    await new Promise((r) => setTimeout(r, 0));

    expect(notifySubscriberRemoved).toHaveBeenCalledOnce();
    expect(notifySubscriberRemoved).toHaveBeenCalledWith({
      email: "user@example.com",
      via: "complaint",
      totalConfirmed: 6,
    });
  });

  it("duplicate SES delivery (idempotent repo) only fires ONE notification when changed:false", async () => {
    // Simulate SES retry: second call returns changed:false
    let callCount = 0;
    const deps = makeDeps();
    const { notifySubscriberRemoved } = deps.slackNotifier;
    vi.spyOn(deps.subscribersRepo, "updateStatus").mockImplementation(
      (id: string, status: SubscriberStatus) => {
        deps.subscribersRepo.statusUpdates.push({ id, status });
        const row = makeSubscriber({ id, status });
        callCount++;
        return Promise.resolve({ changed: callCount === 1, next: status, row });
      },
    );

    const inner = makePermanentBounceInner();
    deps.verifySns.mockResolvedValue(makeSnsNotification(inner));
    const app = buildApp(deps);

    // First delivery
    await postSes(app, JSON.stringify(makeSnsNotification(inner)));
    // Second delivery (SES retry)
    await postSes(app, JSON.stringify(makeSnsNotification(inner)));
    await new Promise((r) => setTimeout(r, 0));

    // Only the first call should have triggered the Slack notification
    expect(notifySubscriberRemoved).toHaveBeenCalledOnce();
  });
});
