import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";

import { createTwitterNotifier } from "../../../../src/social/twitter/notifier.js";
import type {
  TwitterApiClient,
  TwitterCreatePostResult,
} from "../../../../src/social/twitter/types.js";
import type {
  PipelineRunArchiveRow,
  RunArchivesRepo,
} from "../../../../src/repositories/run-archives.js";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-05-11T12:00:00.000Z");

function makeLogger(): Logger {
  const noop = (): undefined => undefined;
  const stub = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: (): Logger => makeLogger(),
  };
  return stub as unknown as Logger;
}

function makeArchive(
  overrides: Partial<PipelineRunArchiveRow> = {},
): PipelineRunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [],
    topN: 10,
    reviewed: true,
    completedAt: NOW,
    digestHeadline: "Daily AI digest headline",
    digestSummary: "Today's recap.",
    hook: "Hook line for social.",
    twitterSummary: "Twitter-native summary for the feed.",
    sourceTelemetry: null,
    slackNotifiedAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    ...overrides,
  } as PipelineRunArchiveRow;
}

function rankedItem(rawItemId: number): PipelineRunArchiveRow["rankedItems"][number] {
  return {
    rawItemId,
    score: rawItemId,
    rationale: "test rationale",
  };
}

interface TestDeps {
  apiClient: { createPost: ReturnType<typeof vi.fn> };
  archives: {
    findById: ReturnType<typeof vi.fn>;
    markTwitterPosted: ReturnType<typeof vi.fn>;
    recordSocialFailure: ReturnType<typeof vi.fn>;
  };
  rawItems: { findByIds: ReturnType<typeof vi.fn> };
}

function buildDeps(opts: {
  archive: PipelineRunArchiveRow | null;
  postResult?: TwitterCreatePostResult;
  postThrows?: Error;
  rawItems?: unknown[];
}): TestDeps {
  const apiClient = {
    createPost: vi.fn().mockImplementation(() => {
      if (opts.postThrows !== undefined) throw opts.postThrows;
      return Promise.resolve(
        opts.postResult ?? {
          ok: true,
          tweetId: "999",
          tweetUrl: "https://x.com/i/status/999",
        },
      );
    }),
  };

  const archives = {
    findById: vi.fn().mockResolvedValue(opts.archive),
    markTwitterPosted: vi.fn().mockResolvedValue(undefined),
    recordSocialFailure: vi.fn().mockResolvedValue(undefined),
  };

  const rawItems = {
    findByIds: vi.fn().mockResolvedValue(opts.rawItems ?? []),
  };

  return { apiClient, archives, rawItems };
}

function build(opts: Parameters<typeof buildDeps>[0]): {
  notifier: ReturnType<typeof createTwitterNotifier>;
  deps: TestDeps;
} {
  const deps = buildDeps(opts);
  const notifier = createTwitterNotifier({
    apiClient: deps.apiClient as unknown as TwitterApiClient,
    archives: deps.archives as unknown as Pick<
      RunArchivesRepo,
      "findById" | "markTwitterPosted" | "recordSocialFailure"
    >,
    rawItems: deps.rawItems as unknown as Parameters<typeof createTwitterNotifier>[0]["rawItems"],
    config: {
      publicArchiveBaseUrl: "https://news.example.com",
      twitterIsPremium: false,
    },
    logger: makeLogger(),
    now: () => NOW,
  });
  return { notifier, deps };
}

describe("createTwitterNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: composes one non-premium summary post and marks twitter_posted_at + permalink", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({
        rankedItems: [rankedItem(1), rankedItem(2), rankedItem(3)],
      }),
      rawItems: [
        {
          id: 1,
          title: "Fallback title 1",
          metadata: {
            recap: {
              title: "Google folds Gemini into Android",
              summary: "Summary 1.",
            },
          },
        },
        {
          id: 2,
          title: "Fallback title 2",
          metadata: {
            recap: {
              title: "HubSpot ships AI dashboard",
              summary: "Summary 2.",
            },
          },
        },
        {
          id: 3,
          title: "Fallback title 3",
          metadata: {
            recap: {
              title: "Mira Murati previews multimodal models",
              summary: "Summary 3.",
            },
          },
        },
      ],
      postResult: {
        ok: true,
        tweetId: "1234",
        tweetUrl: "https://x.com/i/status/1234",
      },
    });

    // Default mock returns tweetId "999" for the second (reply) call.
    deps.apiClient.createPost.mockResolvedValueOnce({
      ok: true,
      tweetId: "1234",
      tweetUrl: "https://x.com/i/status/1234",
    });
    deps.apiClient.createPost.mockResolvedValueOnce({
      ok: true,
      tweetId: "5678",
      tweetUrl: "https://x.com/i/status/5678",
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/1234",
    });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
    const headCall = deps.apiClient.createPost.mock.calls[0][0];
    expect(headCall.text).toContain("Twitter-native summary for the feed.");
    expect(headCall.text).not.toContain("Daily AI digest headline");
    expect(headCall.text).not.toContain("Hook line for social.");
    // Body should end with the teaser pointing at the reply, but never embed the URL.
    expect(headCall.text).toContain("Full breakdown ↓");
    expect(headCall.text).not.toContain("https://");
    expect(headCall.text).not.toContain("→ ");
    expect(headCall.replyToTweetId).toBeUndefined();

    const replyCall = deps.apiClient.createPost.mock.calls[1][0];
    expect(replyCall.text).toBe(`https://news.example.com/archive/${RUN_ID}`);
    expect(replyCall.replyToTweetId).toBe("1234");

    expect(deps.archives.markTwitterPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "https://x.com/i/status/1234",
      ["1234", "5678"],
    );
  });

  it("premium mode: uses digest headline as lead and lists ranks two through four", async () => {
    const deps = buildDeps({
      archive: makeArchive({
        rankedItems: [rankedItem(1), rankedItem(2), rankedItem(3), rankedItem(4)],
      }),
      rawItems: [
        { id: 1, title: "Fallback title 1", metadata: { recap: { title: "Rank one title" } } },
        { id: 2, title: "Rank two title", metadata: { recap: null } },
        { id: 3, title: "Rank three title", metadata: { recap: null } },
        { id: 4, title: "Rank four title", metadata: { recap: null } },
      ],
      postResult: {
        ok: true,
        tweetId: "5678",
        tweetUrl: "https://x.com/i/status/5678",
      },
    });
    const notifier = createTwitterNotifier({
      apiClient: deps.apiClient as unknown as TwitterApiClient,
      archives: deps.archives as unknown as Pick<
        RunArchivesRepo,
        "findById" | "markTwitterPosted" | "recordSocialFailure"
      >,
      rawItems: deps.rawItems as unknown as Parameters<typeof createTwitterNotifier>[0]["rawItems"],
      config: {
        publicArchiveBaseUrl: "https://news.example.com",
        twitterIsPremium: true,
      },
      logger: makeLogger(),
      now: () => NOW,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/5678",
    });
    const headCall = deps.apiClient.createPost.mock.calls[0][0];
    expect(headCall.text).toContain("Daily AI digest headline");
    expect(headCall.text).not.toContain("→ Rank one title");
    expect(headCall.text).toContain("Also inside:");
    expect(headCall.text).toContain("→ Rank two title");
    expect(headCall.text).toContain("→ Rank three title");
    expect(headCall.text).toContain("→ Rank four title");
    expect(headCall.text).toContain("Twitter-native summary for the feed.");
    expect(headCall.replyToTweetId).toBeUndefined();
  });

  it("non-premium over-limit summary records failure and does not post", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ twitterSummary: "x".repeat(281) }),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "free_plan_over_limit" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
    expect(deps.archives.recordSocialFailure).toHaveBeenCalledWith(
      RUN_ID,
      "twitter",
      "free_plan_over_limit",
    );
  });

  it("idempotency: skipped when twitterPostedAt is set, no api call", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ twitterPostedAt: NOW }),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "already_posted" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("null hook and null twitterSummary → skipped, no api call", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ hook: null, twitterSummary: null }),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "no_headline" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("archive missing → failed, no throw", async () => {
    const { notifier, deps } = build({
      archive: null,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "archive_missing" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("apiClient returns 402 CreditsDepleted → recordSocialFailure called, returns http_402", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      postResult: {
        ok: false,
        status: 402,
        body: '{"detail":"credits depleted"}',
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "http_402" });
    expect(deps.archives.recordSocialFailure).toHaveBeenCalledWith(
      RUN_ID,
      "twitter",
      '402:{"detail":"credits depleted"}',
    );
    expect(deps.archives.markTwitterPosted).not.toHaveBeenCalled();
  });

  it("apiClient throws unexpectedly → caught, returns failed/unexpected; never throws", async () => {
    const { notifier } = build({
      archive: makeArchive(),
      postThrows: new Error("boom"),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "unexpected" });
  });

  it.each([
    { status: 401, body: '{"title":"Unauthorized"}' },
    { status: 403, body: '{"title":"Forbidden"}' },
  ])(
    "apiClient returns $status → records auth_failed without retrying",
    async ({ status, body }) => {
      const { notifier, deps } = build({
        archive: makeArchive(),
      });
      deps.apiClient.createPost.mockResolvedValueOnce({
        ok: false,
        status,
        body,
      });

      const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

      expect(result).toEqual({ status: "failed", reason: "auth_failed" });
      expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
      expect(deps.archives.recordSocialFailure).toHaveBeenCalledWith(
        RUN_ID,
        "twitter",
        `${status}:${body}`,
      );
      expect(deps.archives.markTwitterPosted).not.toHaveBeenCalled();
    },
  );

  it("reply tweet failure: head still treated as posted, no recordSocialFailure, only head tweetId stored", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
    });
    deps.apiClient.createPost
      .mockResolvedValueOnce({
        ok: true,
        tweetId: "head-1",
        tweetUrl: "https://x.com/i/status/head-1",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        body: "rate limited",
      });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/head-1",
    });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
    expect(deps.archives.recordSocialFailure).not.toHaveBeenCalled();
    expect(deps.archives.markTwitterPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "https://x.com/i/status/head-1",
      ["head-1"],
    );
  });

  it("reply tweet contains only the archive URL and replies to the head tweet", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
    });
    deps.apiClient.createPost
      .mockResolvedValueOnce({
        ok: true,
        tweetId: "head-2",
        tweetUrl: "https://x.com/i/status/head-2",
      })
      .mockResolvedValueOnce({
        ok: true,
        tweetId: "reply-2",
        tweetUrl: "https://x.com/i/status/reply-2",
      });

    await notifier.notifyArchiveReady({ runId: RUN_ID });

    const replyCall = deps.apiClient.createPost.mock.calls[1][0];
    expect(replyCall.text).toBe(`https://news.example.com/archive/${RUN_ID}`);
    expect(replyCall.replyToTweetId).toBe("head-2");
  });

  it("non-auth error (402) → no retry, recorded as failure as before", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      postResult: {
        ok: false,
        status: 402,
        body: '{"detail":"credits depleted"}',
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "http_402" });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
  });
});
