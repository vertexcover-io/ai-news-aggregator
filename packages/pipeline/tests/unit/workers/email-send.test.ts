import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailSendDeps } from "@pipeline/workers/email-send.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { SubscriberSelect } from "@newsletter/shared";

const { handleEmailSendJob } = await import("@pipeline/workers/email-send.js");

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
  };
}

function makeArchive(
  overrides: Partial<PipelineRunArchiveRow> = {},
): PipelineRunArchiveRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
    topN: 5,
    reviewed: true,
    completedAt: new Date("2026-05-18T09:00:00.000Z"),
    digestHeadline: "Agents reshape developer tools",
    digestSummary: "A concise digest summary.",
    hook: null,
    twitterSummary: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    ...overrides,
  };
}

function makeDeps(
  latestArchive: PipelineRunArchiveRow | null,
  overrides: Partial<EmailSendDeps> = {},
): EmailSendDeps {
  const archive = latestArchive ?? makeArchive();
  return {
    emailProvider: {
      send: vi.fn(() => Promise.resolve({ messageId: "msg-1" })),
    },
    subscribersRepo: {
      listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
      findByIds: vi.fn(() => Promise.resolve([makeSubscriber()])),
    },
    emailSendsRepo: {
      create: vi.fn(() => Promise.resolve({ id: "send-1" })),
      findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
    },
    archiveRepo: {
      upsert: vi.fn(() => Promise.resolve()),
      findById: vi.fn(() => Promise.resolve(archive)),
      findLatestTerminal: vi.fn(() => Promise.resolve(latestArchive)),
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
    slackNotifier: {
      notifyNewsletterSent: vi.fn(() => Promise.resolve()),
      notifyReviewPending: vi.fn(() => Promise.resolve()),
      notifyReviewWarning: vi.fn(() => Promise.resolve()),
      notifyPublishFailed: vi.fn(() => Promise.resolve()),
      notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
    },
    sendPacer: { acquire: vi.fn(() => Promise.resolve()) },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleEmailSendJob", () => {
  it("scheduled jobs publish the latest reviewed unsent archive", async () => {
    const archive = makeArchive();
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.archiveRepo.findLatestTerminal).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.findById).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.markEmailSent).toHaveBeenCalledWith(
      archive.id,
      expect.any(Date),
    );
  });

  it("scheduled jobs send a Slack error when the latest archive is unreviewed", async () => {
    const archive = makeArchive({ reviewed: false });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "email-send",
      reason: "latest_unreviewed",
      runId: archive.id,
    });
  });

  it("scheduled jobs send a Slack error when the latest archive failed", async () => {
    const archive = makeArchive({ status: "failed", reviewed: false });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "email-send",
      reason: "latest_failed",
      runId: archive.id,
    });
  });

  it("scheduled jobs no-op when the latest archive was already emailed", async () => {
    const archive = makeArchive({ emailSentAt: new Date("2026-05-18T10:00:00.000Z") });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).not.toHaveBeenCalled();
  });

  it("explicit runId jobs keep exact-archive behavior", async () => {
    const archive = makeArchive({ id: "00000000-0000-0000-0000-000000000123" });
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "job-1",
      data: { runId: archive.id, subscriberIds: "all" },
    });

    expect(deps.archiveRepo.findById).toHaveBeenCalledWith(archive.id);
    expect(deps.archiveRepo.findLatestTerminal).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
  });
});
