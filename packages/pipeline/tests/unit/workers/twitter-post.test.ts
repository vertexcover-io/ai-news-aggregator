import { describe, it, expect, vi } from "vitest";
import type { TwitterPostDeps, TwitterPostJobLike } from "@pipeline/workers/twitter-post.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";

function makeArchive(overrides: Partial<PipelineRunArchiveRow> = {}): PipelineRunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "good" }],
    topN: 5,
    reviewed: true,
    completedAt: new Date("2026-05-01"),
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
    ...overrides,
  };
}

type TestDeps = TwitterPostDeps & {
  readonly notifyPublishFailedSpy: ReturnType<typeof vi.fn>;
  readonly notifyArchiveReadySpy: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<TwitterPostDeps> = {}): TestDeps {
  const notifyPublishFailedSpy = vi.fn().mockResolvedValue(undefined);
  const notifyArchiveReadySpy = vi.fn().mockResolvedValue({ status: "posted", permalink: "https://x.com/i/web/status/1" });
  const base: TwitterPostDeps = {
    archiveRepo: {
      findById: vi.fn().mockResolvedValue(makeArchive()),
      upsert: vi.fn(),
      markSlackNotified: vi.fn(),
      markEmailSent: vi.fn(),
      markNotification: vi.fn(),
      markLinkedInPosted: vi.fn(),
      markTwitterPosted: vi.fn(),
      recordSocialFailure: vi.fn(),
    },
    twitterNotifier: {
      notifyArchiveReady: notifyArchiveReadySpy,
    },
    slackNotifier: {
      notifyNewsletterSent: vi.fn(),
      notifyReviewPending: vi.fn(),
      notifyReviewWarning: vi.fn(),
      notifyPublishFailed: notifyPublishFailedSpy,
    },
    ...overrides,
  };
  return Object.assign(base, { notifyPublishFailedSpy, notifyArchiveReadySpy });
}

function makeJob(overrides: Partial<TwitterPostJobLike> = {}): TwitterPostJobLike {
  return {
    name: "twitter-post",
    id: "job-1",
    data: { runId: "run-1" },
    ...overrides,
  };
}

const { handleTwitterPostJob } = await import("@pipeline/workers/twitter-post.js");

describe("handleTwitterPostJob", () => {
  it("returns immediately without calling deps when job name is not 'twitter-post'", async () => {
    const deps = makeDeps();
    await handleTwitterPostJob(deps, makeJob({ name: "daily-run" }));
    expect(deps.archiveRepo.findById).not.toHaveBeenCalled();
    expect(deps.notifyPublishFailedSpy).not.toHaveBeenCalled();
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("returns immediately when archive is not found", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        markSlackNotified: vi.fn(),
        markEmailSent: vi.fn(),
        markNotification: vi.fn(),
        markLinkedInPosted: vi.fn(),
        markTwitterPosted: vi.fn(),
        recordSocialFailure: vi.fn(),
      },
    });
    await handleTwitterPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).not.toHaveBeenCalled();
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("calls notifyPublishFailed and skips twitter notifier when archive is not reviewed", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(makeArchive({ reviewed: false })),
        upsert: vi.fn(),
        markSlackNotified: vi.fn(),
        markEmailSent: vi.fn(),
        markNotification: vi.fn(),
        markLinkedInPosted: vi.fn(),
        markTwitterPosted: vi.fn(),
        recordSocialFailure: vi.fn(),
      },
    });
    await handleTwitterPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).toHaveBeenCalledWith({
      runId: "run-1",
      channel: "twitter-post",
    });
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("returns without calling either notifier when archive is reviewed and already posted", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(
          makeArchive({ reviewed: true, twitterPostedAt: new Date("2026-05-01T10:00:00Z") }),
        ),
        upsert: vi.fn(),
        markSlackNotified: vi.fn(),
        markEmailSent: vi.fn(),
        markNotification: vi.fn(),
        markLinkedInPosted: vi.fn(),
        markTwitterPosted: vi.fn(),
        recordSocialFailure: vi.fn(),
      },
    });
    await handleTwitterPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).not.toHaveBeenCalled();
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("calls notifyArchiveReady when archive is reviewed and not yet posted", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(
          makeArchive({ reviewed: true, twitterPostedAt: null }),
        ),
        upsert: vi.fn(),
        markSlackNotified: vi.fn(),
        markEmailSent: vi.fn(),
        markNotification: vi.fn(),
        markLinkedInPosted: vi.fn(),
        markTwitterPosted: vi.fn(),
        recordSocialFailure: vi.fn(),
      },
    });
    await handleTwitterPostJob(deps, makeJob());
    expect(deps.notifyArchiveReadySpy).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("does not throw when twitterNotifier is null and archive is ready to post", async () => {
    const deps = makeDeps({ twitterNotifier: null });
    await expect(handleTwitterPostJob(deps, makeJob())).resolves.toBeUndefined();
  });
});
