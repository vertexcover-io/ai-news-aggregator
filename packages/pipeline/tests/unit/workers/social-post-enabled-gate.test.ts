import { describe, it, expect, vi } from "vitest";
import { handleTwitterPostJob } from "@pipeline/workers/twitter-post.js";
import { handleLinkedInPostJob } from "@pipeline/workers/linkedin-post.js";
import type { RunArchivesRepo, PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type { TwitterNotifier } from "@pipeline/social/twitter/index.js";
import type { LinkedInNotifier } from "@pipeline/social/linkedin/index.js";
import type { UserSettings } from "@newsletter/shared";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

function makeEligibleArchive(overrides: Partial<PipelineRunArchiveRow> = {}): PipelineRunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [],
    topN: 10,
    reviewed: true,
    isDryRun: false,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    completedAt: new Date("2026-06-16T00:00:00.000Z"),
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    notificationState: null,
    ...overrides,
  } as unknown as PipelineRunArchiveRow;
}

function makeArchiveRepo(archive: PipelineRunArchiveRow | null): {
  repo: RunArchivesRepo;
  findById: ReturnType<typeof vi.fn>;
} {
  const findById = vi.fn(() => Promise.resolve(archive));
  const repo = { findById } as unknown as RunArchivesRepo;
  return { repo, findById };
}

function makeSettingsRepo(settings: Partial<UserSettings> | null): UserSettingsRepo {
  return {
    get: () => Promise.resolve(settings as UserSettings | null),
  };
}

function makeTwitterNotifier(): { notifier: TwitterNotifier; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(() => Promise.resolve({ status: "posted" as const, permalink: null }));
  return { notifier: { notifyArchiveReady: spy }, spy };
}

function makeLinkedInNotifier(): { notifier: LinkedInNotifier; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(() => Promise.resolve({ status: "posted" as const, permalink: null }));
  return { notifier: { notifyArchiveReady: spy }, spy };
}

describe("twitter-post worker respects twitterPostEnabled toggle", () => {
  it("skips posting and never resolves the archive when twitterPostEnabled is false", async () => {
    const { repo, findById } = makeArchiveRepo(makeEligibleArchive());
    const { notifier, spy } = makeTwitterNotifier();
    const userSettingsRepo = makeSettingsRepo({ twitterPostEnabled: false });

    await handleTwitterPostJob(
      { archiveRepo: repo, twitterNotifier: notifier, userSettingsRepo },
      { name: "twitter-post", data: { runId: RUN_ID } },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it("posts when twitterPostEnabled is true", async () => {
    const { repo } = makeArchiveRepo(makeEligibleArchive());
    const { notifier, spy } = makeTwitterNotifier();
    const userSettingsRepo = makeSettingsRepo({ twitterPostEnabled: true });

    await handleTwitterPostJob(
      { archiveRepo: repo, twitterNotifier: notifier, userSettingsRepo },
      { name: "twitter-post", data: { runId: RUN_ID } },
    );

    expect(spy).toHaveBeenCalledOnce();
  });

  it("posts when settings are absent (no toggle persisted)", async () => {
    const { repo } = makeArchiveRepo(makeEligibleArchive());
    const { notifier, spy } = makeTwitterNotifier();
    const userSettingsRepo = makeSettingsRepo(null);

    await handleTwitterPostJob(
      { archiveRepo: repo, twitterNotifier: notifier, userSettingsRepo },
      { name: "twitter-post", data: { runId: RUN_ID } },
    );

    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("linkedin-post worker respects linkedinEnabled toggle", () => {
  it("skips posting and never resolves the archive when linkedinEnabled is false", async () => {
    const { repo, findById } = makeArchiveRepo(makeEligibleArchive());
    const { notifier, spy } = makeLinkedInNotifier();
    const userSettingsRepo = makeSettingsRepo({ linkedinEnabled: false });

    await handleLinkedInPostJob(
      { archiveRepo: repo, linkedinNotifier: notifier, userSettingsRepo },
      { name: "linkedin-post", data: { runId: RUN_ID } },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it("posts when linkedinEnabled is true", async () => {
    const { repo } = makeArchiveRepo(makeEligibleArchive());
    const { notifier, spy } = makeLinkedInNotifier();
    const userSettingsRepo = makeSettingsRepo({ linkedinEnabled: true });

    await handleLinkedInPostJob(
      { archiveRepo: repo, linkedinNotifier: notifier, userSettingsRepo },
      { name: "linkedin-post", data: { runId: RUN_ID } },
    );

    expect(spy).toHaveBeenCalledOnce();
  });
});
