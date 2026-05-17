import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";

import { createTwitterNotifier } from "../../../../src/social/twitter/notifier.js";
import type {
  TwitterApiClient,
  TwitterCreatePostResult,
} from "../../../../src/social/twitter/types.js";
import type {
  SocialTokenRow,
  SocialTokensRepo,
  SocialTokensTx,
} from "../../../../src/repositories/social-tokens.js";
import type {
  PipelineRunArchiveRow,
  RunArchivesRepo,
} from "../../../../src/repositories/run-archives.js";
import type { TwitterRefreshResult } from "../../../../src/social/twitter/oauth.js";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-05-11T12:00:00.000Z");
const FUTURE = new Date("2026-05-12T12:00:00.000Z");
const PAST = new Date("2026-05-11T11:00:00.000Z");

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

function makeTokenRow(
  overrides: Partial<SocialTokenRow> = {},
): SocialTokenRow {
  return {
    platform: "twitter",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: FUTURE,
    metadata: null,
    updatedAt: NOW,
    ...overrides,
  };
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
  tokens: { withTokenLock: ReturnType<typeof vi.fn> };
  refreshFn: ReturnType<typeof vi.fn>;
  saveTokenSpy: ReturnType<typeof vi.fn>;
}

function buildDeps(opts: {
  archive: PipelineRunArchiveRow | null;
  tokenRow: SocialTokenRow | null;
  postResult?: TwitterCreatePostResult;
  postThrows?: Error;
  refreshResult?: TwitterRefreshResult;
  rawItems?: unknown[];
}): TestDeps {
  const saveTokenSpy = vi.fn().mockResolvedValue(undefined);
  const tx: SocialTokensTx = { saveToken: saveTokenSpy };

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

  const tokens = {
    withTokenLock: vi
      .fn()
      .mockImplementation(
        async (
          _platform: string,
          fn: (
            row: SocialTokenRow | null,
            tx: SocialTokensTx,
          ) => Promise<unknown>,
        ) => fn(opts.tokenRow, tx),
      ),
  };

  const refreshFn = vi
    .fn()
    .mockResolvedValue(
      opts.refreshResult ?? {
        ok: true,
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresAt: FUTURE,
      },
    );

  return { apiClient, archives, rawItems, tokens, refreshFn, saveTokenSpy };
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
    tokens: deps.tokens as unknown as Pick<SocialTokensRepo, "withTokenLock">,
    refreshFn: deps.refreshFn,
    config: {
      clientId: "cid",
      clientSecret: "csec",
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
      tokenRow: makeTokenRow(),
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

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/1234",
    });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
    const headCall = deps.apiClient.createPost.mock.calls[0][0];
    expect(headCall.accessToken).toBe("access-1");
    expect(headCall.text).toContain("Twitter-native summary for the feed.");
    expect(headCall.text).not.toContain("Daily AI digest headline");
    expect(headCall.text).not.toContain("Hook line for social.");
    expect(headCall.text).toContain("Full breakdown ↓");
    expect(headCall.text).toContain(
      `https://news.example.com/archive/${RUN_ID}`,
    );
    expect(headCall.text).not.toContain("→ ");
    expect(headCall.text.indexOf("Twitter-native summary for the feed.")).toBeLessThan(
      headCall.text.indexOf("Full breakdown ↓"),
    );
    expect(headCall.replyToTweetId).toBeUndefined();
    expect(deps.archives.markTwitterPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "https://x.com/i/status/1234",
      ["1234"],
    );
  });

  it("premium mode: uses digest headline as lead and lists ranks two through four", async () => {
    const deps = buildDeps({
      archive: makeArchive({
        rankedItems: [rankedItem(1), rankedItem(2), rankedItem(3), rankedItem(4)],
      }),
      tokenRow: makeTokenRow(),
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
      tokens: deps.tokens as unknown as Pick<SocialTokensRepo, "withTokenLock">,
      refreshFn: deps.refreshFn,
      config: {
        clientId: "cid",
        clientSecret: "csec",
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
      archive: makeArchive({ twitterSummary: "x".repeat(260) }),
      tokenRow: makeTokenRow(),
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
      tokenRow: makeTokenRow(),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "already_posted" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
    expect(deps.tokens.withTokenLock).not.toHaveBeenCalled();
  });

  it("null hook and null twitterSummary → skipped, no api call", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ hook: null, twitterSummary: null }),
      tokenRow: makeTokenRow(),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "no_headline" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("archive missing → failed, no throw", async () => {
    const { notifier, deps } = build({
      archive: null,
      tokenRow: makeTokenRow(),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "archive_missing" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("token row missing → skipped no_token, no api call", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: null,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "no_token" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("token expired → calls refreshFn, saves new token, uses new access token", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow({ expiresAt: PAST }),
      refreshResult: {
        ok: true,
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresAt: FUTURE,
      },
      postResult: {
        ok: true,
        tweetId: "42",
        tweetUrl: "https://x.com/i/status/42",
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/42",
    });
    expect(deps.refreshFn).toHaveBeenCalledTimes(1);
    expect(deps.saveTokenSpy).toHaveBeenCalledWith("twitter", {
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresAt: FUTURE,
      metadata: null,
    });
    expect(deps.apiClient.createPost.mock.calls[0][0].accessToken).toBe(
      "fresh-access",
    );
  });

  it("refreshFn returns ok:false → failed, no api call", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow({ expiresAt: PAST }),
      refreshResult: { ok: false, status: 400, body: "invalid_grant" },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "refresh_failed" });
    expect(deps.saveTokenSpy).not.toHaveBeenCalled();
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("apiClient returns 402 CreditsDepleted → recordSocialFailure called, returns http_402", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
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
      tokenRow: makeTokenRow(),
      postThrows: new Error("boom"),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "unexpected" });
  });

  it("apiClient returns 401 → forces a refresh, retries once, succeeds", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(), // DB says token is still valid (FUTURE)
    });
    // First call: 401. Second call: success.
    deps.apiClient.createPost
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        body: '{"title":"Unauthorized"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        tweetId: "111",
        tweetUrl: "https://x.com/i/status/111",
      });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/111",
    });
    // refreshFn was called once even though DB TTL said "still valid".
    expect(deps.refreshFn).toHaveBeenCalledTimes(1);
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
    expect(deps.apiClient.createPost.mock.calls[0][0].accessToken).toBe(
      "access-1",
    );
    expect(deps.apiClient.createPost.mock.calls[1][0].accessToken).toBe(
      "access-2",
    );
    expect(deps.archives.markTwitterPosted).toHaveBeenCalledTimes(1);
    expect(deps.archives.recordSocialFailure).not.toHaveBeenCalled();
  });

  it("apiClient returns 403 → forces a refresh, retries once", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
    });
    deps.apiClient.createPost
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        body: '{"title":"Forbidden"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        tweetId: "222",
        tweetUrl: "https://x.com/i/status/222",
      });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({
      status: "posted",
      permalink: "https://x.com/i/status/222",
    });
    expect(deps.refreshFn).toHaveBeenCalledTimes(1);
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
  });

  it("401 then refresh fails → recordSocialFailure with original 401, returns refresh_failed", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      refreshResult: { ok: false, status: 400, body: "invalid_request" },
    });
    deps.apiClient.createPost.mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: '{"title":"Unauthorized"}',
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "refresh_failed" });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
    expect(deps.archives.recordSocialFailure).toHaveBeenCalledWith(
      RUN_ID,
      "twitter",
      '401:{"title":"Unauthorized"}',
    );
    expect(deps.archives.markTwitterPosted).not.toHaveBeenCalled();
  });

  it("non-auth error (402) → no retry, recorded as failure as before", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: {
        ok: false,
        status: 402,
        body: '{"detail":"credits depleted"}',
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "http_402" });
    expect(deps.refreshFn).not.toHaveBeenCalled();
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
  });
});
