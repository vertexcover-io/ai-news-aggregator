import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunArchiveRow, RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { SlackNotifier } from "@newsletter/shared";
import { handleLinkedInPostJob } from "@pipeline/workers/linkedin-post.js";
import { handleTwitterPostJob } from "@pipeline/workers/twitter-post.js";

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

function makeRepo(latestArchive: PipelineRunArchiveRow | null): RunArchivesRepo {
  const archive = latestArchive ?? makeArchive();
  return {
    upsert: vi.fn(() => Promise.resolve()),
    findById: vi.fn(() => Promise.resolve(archive)),
    findLatestTerminal: vi.fn(() => Promise.resolve(latestArchive)),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    markEmailSent: vi.fn(() => Promise.resolve()),
    markNotification: vi.fn(() => Promise.resolve()),
    markLinkedInPosted: vi.fn(() => Promise.resolve()),
    markTwitterPosted: vi.fn(() => Promise.resolve()),
    recordSocialFailure: vi.fn(() => Promise.resolve()),
  };
}

function makeSlack(): SlackNotifier {
  return {
    notifyNewsletterSent: vi.fn(() => Promise.resolve()),
    notifyReviewPending: vi.fn(() => Promise.resolve()),
    notifyReviewWarning: vi.fn(() => Promise.resolve()),
    notifyPublishFailed: vi.fn(() => Promise.resolve()),
    notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
    notifySourceDistribution: vi.fn(() => Promise.resolve()),
    notifyEmailDelivery: vi.fn(() => Promise.resolve()),
    notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
    notifyTwitterPosted: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scheduled LinkedIn publish", () => {
  it("posts the latest reviewed archive", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier: makeSlack() },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(archiveRepo.findLatestTerminal).toHaveBeenCalledOnce();
    expect(linkedinNotifier.notifyArchiveReady).toHaveBeenCalledWith({ runId: archive.id });
  });

  it("reports an error when the latest archive is failed", async () => {
    const archive = makeArchive({ status: "failed", reviewed: false });
    const archiveRepo = makeRepo(archive);
    const notifyPublishUnavailable = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = {
      ...makeSlack(),
      notifyPublishUnavailable,
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: null, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "linkedin-post",
      reason: "latest_failed",
      runId: archive.id,
    });
  });
});

describe("scheduled Twitter publish", () => {
  it("reports an error when the latest archive is unreviewed", async () => {
    const archive = makeArchive({ reviewed: false });
    const archiveRepo = makeRepo(archive);
    const notifyPublishUnavailable = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = {
      ...makeSlack(),
      notifyPublishUnavailable,
    };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: null, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "twitter-post",
      reason: "latest_unreviewed",
      runId: archive.id,
    });
  });
});

// ---- Phase 2: LinkedIn Slack notification (VS-6, VS-7) ----

describe("linkedin-post notifyLinkedinPosted (Phase 2 VS-6, VS-7)", () => {
  // VS-6 / REQ-006: happy path — posted + permalink → notifyLinkedinPosted called
  it("VS-6: calls notifyLinkedinPosted when notifyArchiveReady returns posted with permalink", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyLinkedinPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = {
      ...makeSlack(),
      notifyLinkedinPosted,
    };
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "posted" as const, permalink: "urn:li:share:123" }),
      ),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyLinkedinPosted).toHaveBeenCalledOnce();
    expect(notifyLinkedinPosted).toHaveBeenCalledWith({
      runId: archive.id,
      permalink: "urn:li:share:123",
    });
  });

  // VS-7 / REQ-007: skip cases — notifyLinkedinPosted NOT called
  it("VS-7a: does not call notifyLinkedinPosted when result is skipped", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyLinkedinPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyLinkedinPosted };
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "skipped" as const, reason: "already_posted" as const }),
      ),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyLinkedinPosted).not.toHaveBeenCalled();
  });

  it("VS-7b: does not call notifyLinkedinPosted when result is already_posted skipped", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyLinkedinPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyLinkedinPosted };
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "skipped" as const, reason: "no_headline" as const }),
      ),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyLinkedinPosted).not.toHaveBeenCalled();
  });

  it("VS-7c: does not call notifyLinkedinPosted when result is failed", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyLinkedinPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyLinkedinPosted };
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "failed" as const, reason: "API error" }),
      ),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyLinkedinPosted).not.toHaveBeenCalled();
  });

  it("VS-7d: does not call notifyLinkedinPosted when result is posted with null permalink", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyLinkedinPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyLinkedinPosted };
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "posted" as const, permalink: null }),
      ),
    };

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier, slackNotifier },
      { name: "linkedin-post", id: "job-1", data: {} },
    );

    expect(notifyLinkedinPosted).not.toHaveBeenCalled();
  });
});

// ---- Phase 2: Twitter Slack notification (VS-8, VS-9) ----

describe("twitter-post notifyTwitterPosted (Phase 2 VS-8, VS-9)", () => {
  // VS-8 / REQ-008: happy path — posted + permalink → notifyTwitterPosted called
  it("VS-8: calls notifyTwitterPosted when notifyArchiveReady returns posted with permalink", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyTwitterPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = {
      ...makeSlack(),
      notifyTwitterPosted,
    };
    const twitterNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({
          status: "posted" as const,
          permalink: "https://x.com/user/status/123456789",
        }),
      ),
    };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyTwitterPosted).toHaveBeenCalledOnce();
    expect(notifyTwitterPosted).toHaveBeenCalledWith({
      runId: archive.id,
      permalink: "https://x.com/user/status/123456789",
    });
  });

  // VS-9 / REQ-009: skip cases — notifyTwitterPosted NOT called
  it("VS-9a: does not call notifyTwitterPosted when result is skipped", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyTwitterPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyTwitterPosted };
    const twitterNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "skipped" as const, reason: "already_posted" as const }),
      ),
    };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyTwitterPosted).not.toHaveBeenCalled();
  });

  it("VS-9b: does not call notifyTwitterPosted when result is failed", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyTwitterPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyTwitterPosted };
    const twitterNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "failed" as const, reason: "API error" }),
      ),
    };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyTwitterPosted).not.toHaveBeenCalled();
  });

  it("VS-9c: does not call notifyTwitterPosted when result is posted with null permalink", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyTwitterPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyTwitterPosted };
    const twitterNotifier = {
      notifyArchiveReady: vi.fn(() =>
        Promise.resolve({ status: "posted" as const, permalink: null }),
      ),
    };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyTwitterPosted).not.toHaveBeenCalled();
  });

  it("VS-9d: does not call notifyTwitterPosted when twitterNotifier is null", async () => {
    const archive = makeArchive();
    const archiveRepo = makeRepo(archive);
    const notifyTwitterPosted = vi.fn(() => Promise.resolve());
    const slackNotifier: SlackNotifier = { ...makeSlack(), notifyTwitterPosted };

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: null, slackNotifier },
      { name: "twitter-post", id: "job-1", data: {} },
    );

    expect(notifyTwitterPosted).not.toHaveBeenCalled();
  });
});
