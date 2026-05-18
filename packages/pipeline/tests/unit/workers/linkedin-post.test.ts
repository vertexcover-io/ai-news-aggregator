import { describe, it, expect, vi } from "vitest";
import type { LinkedInPostDeps, LinkedInPostJobLike } from "@pipeline/workers/linkedin-post.js";
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

type TestDeps = LinkedInPostDeps & {
  readonly notifyPublishFailedSpy: ReturnType<typeof vi.fn>;
  readonly notifyArchiveReadySpy: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<LinkedInPostDeps> = {}): TestDeps {
  const notifyPublishFailedSpy = vi.fn().mockResolvedValue(undefined);
  const notifyArchiveReadySpy = vi.fn().mockResolvedValue({ status: "posted", permalink: "urn:li:share:1" });
  const base: LinkedInPostDeps = {
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
    linkedinNotifier: {
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

function makeJob(overrides: Partial<LinkedInPostJobLike> = {}): LinkedInPostJobLike {
  return {
    name: "linkedin-post",
    id: "job-1",
    data: { runId: "run-1" },
    ...overrides,
  };
}

const { handleLinkedInPostJob } = await import("@pipeline/workers/linkedin-post.js");

describe("handleLinkedInPostJob", () => {
  it("returns immediately without calling deps when job name is not 'linkedin-post'", async () => {
    const deps = makeDeps();
    await handleLinkedInPostJob(deps, makeJob({ name: "daily-run" }));
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
    await handleLinkedInPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).not.toHaveBeenCalled();
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("calls notifyPublishFailed and skips linkedin notifier when archive is not reviewed", async () => {
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
    await handleLinkedInPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).toHaveBeenCalledWith({
      runId: "run-1",
      channel: "linkedin-post",
    });
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("returns without calling either notifier when archive is reviewed and already posted", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(
          makeArchive({ reviewed: true, linkedinPostedAt: new Date("2026-05-01T10:00:00Z") }),
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
    await handleLinkedInPostJob(deps, makeJob());
    expect(deps.notifyPublishFailedSpy).not.toHaveBeenCalled();
    expect(deps.notifyArchiveReadySpy).not.toHaveBeenCalled();
  });

  it("calls notifyArchiveReady when archive is reviewed and not yet posted", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(
          makeArchive({ reviewed: true, linkedinPostedAt: null }),
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
    await handleLinkedInPostJob(deps, makeJob());
    expect(deps.notifyArchiveReadySpy).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("does not throw when linkedinNotifier is null and archive is ready to post", async () => {
    const deps = makeDeps({ linkedinNotifier: null });
    await expect(handleLinkedInPostJob(deps, makeJob())).resolves.toBeUndefined();
  });
});
