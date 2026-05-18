import { describe, it, expect, vi } from "vitest";
import type { ReviewWarningDeps, ReviewWarningJobLike } from "@pipeline/workers/review-warning.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { UserSettings } from "@newsletter/shared";

function makeArchive(overrides: Partial<PipelineRunArchiveRow> = {}): PipelineRunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "good" }],
    topN: 5,
    reviewed: false,
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

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings-1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "06:00",
    pipelineTime: "06:00",
    emailTime: "09:00",
    linkedinTime: "10:00",
    twitterTime: "11:00",
    scheduleTimezone: "America/New_York",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

type TestDeps = ReviewWarningDeps & {
  readonly notifyReviewWarningSpy: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<ReviewWarningDeps> = {}): TestDeps {
  const notifyReviewWarningSpy = vi.fn().mockResolvedValue(undefined);
  const base: ReviewWarningDeps = {
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
    userSettingsRepo: {
      get: vi.fn().mockResolvedValue(makeSettings()),
    },
    slackNotifier: {
      notifyNewsletterSent: vi.fn(),
      notifyReviewPending: vi.fn(),
      notifyReviewWarning: notifyReviewWarningSpy,
      notifyPublishFailed: vi.fn(),
    },
    ...overrides,
  };
  return Object.assign(base, { notifyReviewWarningSpy });
}

function makeJob(overrides: Partial<ReviewWarningJobLike> = {}): ReviewWarningJobLike {
  return {
    name: "review-warning",
    id: "job-1",
    data: { runId: "run-1" },
    ...overrides,
  };
}

const { handleReviewWarningJob } = await import("@pipeline/workers/review-warning.js");

describe("handleReviewWarningJob", () => {
  it("returns immediately without calling deps when job name is not 'review-warning'", async () => {
    const deps = makeDeps();
    await handleReviewWarningJob(deps, makeJob({ name: "daily-run" }));
    expect(deps.archiveRepo.findById).not.toHaveBeenCalled();
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
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
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.userSettingsRepo.get).not.toHaveBeenCalled();
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
  });

  it("returns immediately when archive is already reviewed", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(makeArchive({ reviewed: true })),
        upsert: vi.fn(),
        markSlackNotified: vi.fn(),
        markEmailSent: vi.fn(),
        markNotification: vi.fn(),
        markLinkedInPosted: vi.fn(),
        markTwitterPosted: vi.fn(),
        recordSocialFailure: vi.fn(),
      },
    });
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.userSettingsRepo.get).not.toHaveBeenCalled();
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
  });

  it("returns immediately when userSettings is null", async () => {
    const deps = makeDeps({
      userSettingsRepo: { get: vi.fn().mockResolvedValue(null) },
    });
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
  });

  it("returns immediately when autoReview is true", async () => {
    const deps = makeDeps({
      userSettingsRepo: { get: vi.fn().mockResolvedValue(makeSettings({ autoReview: true })) },
    });
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
  });

  it("sends no slack notification when all publish channels are disabled", async () => {
    const deps = makeDeps({
      userSettingsRepo: {
        get: vi.fn().mockResolvedValue(
          makeSettings({ emailEnabled: false, linkedinEnabled: false, twitterPostEnabled: false }),
        ),
      },
    });
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.notifyReviewWarningSpy).not.toHaveBeenCalled();
  });

  it("calls notifyReviewWarning with correct args when email is the only enabled channel and not yet sent", async () => {
    const settings = makeSettings({
      emailEnabled: true,
      emailTime: "09:00",
      linkedinEnabled: false,
      twitterPostEnabled: false,
    });
    const deps = makeDeps({
      userSettingsRepo: { get: vi.fn().mockResolvedValue(settings) },
    });
    await handleReviewWarningJob(deps, makeJob());
    expect(deps.notifyReviewWarningSpy).toHaveBeenCalledWith({
      runId: "run-1",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 5,
    });
  });

  it("does not throw when slackNotifier is undefined and archive needs warning", async () => {
    const deps = makeDeps({ slackNotifier: undefined });
    await expect(handleReviewWarningJob(deps, makeJob())).resolves.toBeUndefined();
  });
});
