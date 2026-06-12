/**
 * Phase 7: broadcast sending-domain gate on the legacy send-newsletter worker
 * (REQ-053 / EDGE-005/006 / NF3) — mirrors the email-send gate tests.
 */
import { describe, expect, it, vi } from "vitest";
import type { NewsletterSendDeps } from "@pipeline/workers/newsletter-send.js";
import { handleNewsletterSendJob } from "@pipeline/workers/newsletter-send.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { SubscriberSelect } from "@newsletter/shared";

const RUN_ID = "00000000-0000-0000-0000-000000000001";

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: "sub-1",
    email: "test@example.com",
    status: "confirmed",
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: new Date("2026-01-01T00:00:00.000Z"),
    unsubscribedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as SubscriberSelect;
}

function makeArchive(): PipelineRunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
    topN: 5,
    reviewed: true,
    completedAt: new Date("2026-05-18T09:00:00.000Z"),
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    twitterSummary: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
  } as PipelineRunArchiveRow;
}

function makeDeps(overrides: Partial<NewsletterSendDeps> = {}): NewsletterSendDeps {
  return {
    emailProvider: { send: vi.fn(() => Promise.resolve({ messageId: "msg-1" })) },
    subscribersRepo: {
      listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
      findByIds: vi.fn(() => Promise.resolve([makeSubscriber({ id: "new-sub" })])),
    },
    emailSendsRepo: {
      create: vi.fn(() => Promise.resolve({ id: "send-1" })),
      findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
    },
    archiveRepo: {
      upsert: vi.fn(() => Promise.resolve()),
      findById: vi.fn(() => Promise.resolve(makeArchive())),
      findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      markSlackNotified: vi.fn(() => Promise.resolve()),
      markEmailSent: vi.fn(() => Promise.resolve()),
      markNotification: vi.fn(() => Promise.resolve()),
      markLinkedInPosted: vi.fn(() => Promise.resolve()),
      markTwitterPosted: vi.fn(() => Promise.resolve()),
      recordSocialFailure: vi.fn(() => Promise.resolve()),
    },
    rawItemsRepo: {
      upsertItems: vi.fn(),
      findExistingExternalIds: vi.fn(() => Promise.resolve(new Set<string>())),
      findBySourceAndExternalId: vi.fn(() => Promise.resolve(null)),
      findByIds: vi.fn(() =>
        Promise.resolve([
          {
            id: 1,
            sourceType: "hn",
            externalId: "hn-1",
            title: "Story title",
            url: "https://example.com/story",
            sourceUrl: null,
            author: null,
            content: null,
            imageUrl: null,
            publishedAt: null,
            engagement: { points: 10, commentCount: 1 },
            metadata: { comments: [] },
          },
        ]),
      ),
      updateRecapData: vi.fn(),
      listForRun: vi.fn(() => Promise.resolve([])),
    },
    renderNewsletter: vi.fn(() => Promise.resolve("<html>newsletter</html>")),
    sessionSecret: "secret",
    fromMail: "newsletter@example.com",
    baseUrl: "https://newsletter.example.com",
    sendPacer: { acquire: vi.fn(() => Promise.resolve()) },
    ...overrides,
  } as NewsletterSendDeps;
}

describe("handleNewsletterSendJob — broadcast sending-domain gate", () => {
  it("verified sending domain: broadcast goes out from the domain sender", async () => {
    const deps = makeDeps({
      broadcastSender: { kind: "send", from: "newsletter@acme.com" },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });

    expect(deps.emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "newsletter@acme.com" }),
    );
  });

  it("blocked: broadcast is skipped cleanly and reported (EDGE-006)", async () => {
    const notifyPublishFailed = vi.fn(() => Promise.resolve());
    const deps = makeDeps({
      broadcastSender: { kind: "blocked", reason: "no_sending_domain" },
      slackNotifier: {
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyPublishFailed,
        notifySourceDistribution: vi.fn(() => Promise.resolve()),
        notifyEmailDelivery: vi.fn(() => Promise.resolve()),
        notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
        notifyTwitterPosted: vi.fn(() => Promise.resolve()),
        notifySubscriberConfirmed: vi.fn(() => Promise.resolve()),
        notifySubscriberRemoved: vi.fn(() => Promise.resolve()),
        notifyFeedbackReceived: vi.fn(() => Promise.resolve()),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(notifyPublishFailed).toHaveBeenCalledWith({
      runId: RUN_ID,
      channel: "email-send",
      reason: "no_sending_domain",
    });
  });

  it("targeted send stays on the shared platform sender when blocked (EDGE-005)", async () => {
    const deps = makeDeps({
      broadcastSender: { kind: "blocked", reason: "no_sending_domain" },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: ["new-sub"] },
    });

    expect(deps.emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "newsletter@example.com" }),
    );
  });

  it("no broadcastSender dep: legacy env fromMail behavior is preserved (NF3)", async () => {
    const deps = makeDeps();

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });

    expect(deps.emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "newsletter@example.com" }),
    );
  });

  it("threads tenant branding into the newsletter render", async () => {
    const deps = makeDeps({ branding: { name: "Acme AI Weekly" } });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });

    expect(deps.renderNewsletter).toHaveBeenCalledWith(
      expect.objectContaining({ branding: { name: "Acme AI Weekly" } }),
    );
  });

  it("branded tenants get their newsletter name in the subject; unbranded keeps the platform subject", async () => {
    const branded = makeDeps({ branding: { name: "Acme AI Weekly" } });
    await handleNewsletterSendJob(branded, {
      name: "send-newsletter",
      id: "job-1",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });
    expect(branded.emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringMatching(/^Acme AI Weekly — /) as string,
      }),
    );

    const unbranded = makeDeps();
    await handleNewsletterSendJob(unbranded, {
      name: "send-newsletter",
      id: "job-2",
      data: { runId: RUN_ID, subscriberIds: "all" },
    });
    expect(unbranded.emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringMatching(/^AI Newsletter — /) as string,
      }),
    );
  });
});
