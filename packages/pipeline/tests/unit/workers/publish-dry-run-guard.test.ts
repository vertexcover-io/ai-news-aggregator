import { describe, it, expect, vi } from "vitest";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const { handleLinkedInPostJob } = await import(
  "@pipeline/workers/linkedin-post.js"
);
const { handleTwitterPostJob } = await import(
  "@pipeline/workers/twitter-post.js"
);
const { handleEmailSendJob } = await import("@pipeline/workers/email-send.js");

function makeArchive(
  overrides: Partial<PipelineRunArchiveRow> = {},
): PipelineRunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [{ rawItemId: 1 }],
    topN: 10,
    reviewed: true,
    completedAt: new Date("2026-05-18T19:05:00.000Z"),
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
    isDryRun: false,
    ...overrides,
  };
}

describe("publish workers dry-run guard", () => {
  describe("handleLinkedInPostJob", () => {
    it("skips notifier when archive is dry-run", async () => {
      const archive = makeArchive({ isDryRun: true });
      const archiveRepo = {
        findById: vi.fn(() => Promise.resolve(archive)),
      };
      const linkedinNotifier = {
        notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
      };
      const slackNotifier = {
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
      };

      await handleLinkedInPostJob(
        {
          archiveRepo: archiveRepo as never,
          linkedinNotifier: linkedinNotifier as never,
          slackNotifier: slackNotifier as never,
        },
        { name: "linkedin-post", data: { runId: "run-1" } },
      );

      expect(linkedinNotifier.notifyArchiveReady).not.toHaveBeenCalled();
      expect(slackNotifier.notifyPublishFailed).not.toHaveBeenCalled();
    });

    it("calls notifier for live (non-dry-run) archive", async () => {
      const archive = makeArchive({ isDryRun: false });
      const archiveRepo = {
        findById: vi.fn(() => Promise.resolve(archive)),
      };
      const linkedinNotifier = {
        notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
      };

      await handleLinkedInPostJob(
        {
          archiveRepo: archiveRepo as never,
          linkedinNotifier: linkedinNotifier as never,
        },
        { name: "linkedin-post", data: { runId: "run-1" } },
      );

      expect(linkedinNotifier.notifyArchiveReady).toHaveBeenCalledOnce();
    });
  });

  describe("handleTwitterPostJob", () => {
    it("skips notifier when archive is dry-run", async () => {
      const archive = makeArchive({ isDryRun: true });
      const archiveRepo = {
        findById: vi.fn(() => Promise.resolve(archive)),
      };
      const twitterNotifier = {
        notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
      };
      const slackNotifier = {
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
      };

      await handleTwitterPostJob(
        {
          archiveRepo: archiveRepo as never,
          twitterNotifier: twitterNotifier as never,
          slackNotifier: slackNotifier as never,
        },
        { name: "twitter-post", data: { runId: "run-1" } },
      );

      expect(twitterNotifier.notifyArchiveReady).not.toHaveBeenCalled();
      expect(slackNotifier.notifyPublishFailed).not.toHaveBeenCalled();
    });

    it("calls notifier for live (non-dry-run) archive", async () => {
      const archive = makeArchive({ isDryRun: false });
      const archiveRepo = {
        findById: vi.fn(() => Promise.resolve(archive)),
      };
      const twitterNotifier = {
        notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
      };

      await handleTwitterPostJob(
        {
          archiveRepo: archiveRepo as never,
          twitterNotifier: twitterNotifier as never,
        },
        { name: "twitter-post", data: { runId: "run-1" } },
      );

      expect(twitterNotifier.notifyArchiveReady).toHaveBeenCalledOnce();
    });
  });

  describe("handleEmailSendJob", () => {
    it("returns early without sending when archive is dry-run", async () => {
      const archive = makeArchive({ isDryRun: true });
      const archiveRepo = {
        findById: vi.fn(() => Promise.resolve(archive)),
        markEmailSent: vi.fn(() => Promise.resolve()),
      };
      const emailProvider = {
        send: vi.fn(() => Promise.resolve({ messageId: "m1" })),
      };
      const subscribersRepo = {
        listConfirmed: vi.fn(() => Promise.resolve([])),
        findByIds: vi.fn(() => Promise.resolve([])),
      };
      const emailSendsRepo = {
        findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
        create: vi.fn(() => Promise.resolve()),
      };
      const rawItemsRepo = {
        findByIds: vi.fn(() => Promise.resolve([])),
      };
      const slackNotifier = {
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
      };

      await handleEmailSendJob(
        {
          emailProvider: emailProvider as never,
          subscribersRepo: subscribersRepo as never,
          // Required (fail-closed gate); irrelevant here — dry-run returns early.
          tenantsRepo: {
            getSendingDomainStatus: vi.fn(() => Promise.resolve("verified" as const)),
            getSendingDomainName: vi.fn(() => Promise.resolve(null)),
            getSlug: vi.fn(() => Promise.resolve("inference")),
          },
          emailSendsRepo: emailSendsRepo as never,
          archiveRepo: archiveRepo as never,
          rawItemsRepo: rawItemsRepo as never,
          renderNewsletter: vi.fn(() => Promise.resolve("<html></html>")),
          sessionSecret: "secret",
          fromMail: "from@example.com",
          managedEmailDomain: "news.example.com",
          baseUrl: "https://example.com",
          slackNotifier: slackNotifier as never,
        },
        { name: "email-send", data: { runId: "run-1" } },
      );

      expect(emailProvider.send).not.toHaveBeenCalled();
      expect(subscribersRepo.listConfirmed).not.toHaveBeenCalled();
      expect(archiveRepo.markEmailSent).not.toHaveBeenCalled();
      expect(slackNotifier.notifyNewsletterSent).not.toHaveBeenCalled();
    });
  });
});
