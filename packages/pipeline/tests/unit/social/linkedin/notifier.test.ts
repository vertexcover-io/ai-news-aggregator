import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";

import { createLinkedInNotifier } from "../../../../src/social/linkedin/notifier.js";
import type {
  LinkedInApiClient,
  LinkedInCreatePostResult,
} from "../../../../src/social/linkedin/types.js";
import type {
  SocialTokenRow,
  SocialTokensRepo,
  SocialTokensTx,
} from "../../../../src/repositories/social-tokens.js";
import type {
  PipelineRunArchiveRow,
  RunArchivesRepo,
} from "../../../../src/repositories/run-archives.js";
import type { LinkedInRefreshResult } from "../../../../src/social/linkedin/oauth.js";

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
    rankedItems: [
      { rawItemId: 1, title: "Story 1 title", summary: "Story 1 summary body." },
    ],
    topN: 10,
    reviewed: true,
    completedAt: NOW,
    digestHeadline: "Daily AI digest headline",
    digestSummary: "Today's recap.",
    hook: "Hook line for social.",
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
    platform: "linkedin",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: FUTURE,
    metadata: { personUrn: "urn:li:person:abc" },
    updatedAt: NOW,
    ...overrides,
  };
}

interface TestDeps {
  apiClient: {
    createPost: ReturnType<typeof vi.fn>;
    createComment: ReturnType<typeof vi.fn>;
  };
  archives: {
    findById: ReturnType<typeof vi.fn>;
    markLinkedInPosted: ReturnType<typeof vi.fn>;
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
  postResult?: LinkedInCreatePostResult;
  postThrows?: Error;
  refreshResult?: LinkedInRefreshResult;
}): TestDeps {
  const saveTokenSpy = vi.fn().mockResolvedValue(undefined);
  const tx: SocialTokensTx = { saveToken: saveTokenSpy };

  const apiClient = {
    createPost: vi.fn().mockImplementation(() => {
      if (opts.postThrows !== undefined) throw opts.postThrows;
      return Promise.resolve(
        opts.postResult ?? { ok: true, postUrn: "urn:li:share:999" },
      );
    }),
    createComment: vi.fn().mockResolvedValue({ ok: true }),
  };

  const archives = {
    findById: vi.fn().mockResolvedValue(opts.archive),
    markLinkedInPosted: vi.fn().mockResolvedValue(undefined),
    recordSocialFailure: vi.fn().mockResolvedValue(undefined),
  };

  const rawItems = {
    findByIds: vi.fn().mockResolvedValue([]),
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
  notifier: ReturnType<typeof createLinkedInNotifier>;
  deps: TestDeps;
} {
  const deps = buildDeps(opts);
  const notifier = createLinkedInNotifier({
    apiClient: deps.apiClient as unknown as LinkedInApiClient,
    archives: deps.archives as unknown as Pick<
      RunArchivesRepo,
      "findById" | "markLinkedInPosted" | "recordSocialFailure"
    >,
    rawItems: deps.rawItems as unknown as Parameters<typeof createLinkedInNotifier>[0]["rawItems"],
    tokens: deps.tokens as unknown as Pick<SocialTokensRepo, "withTokenLock">,
    refreshFn: deps.refreshFn,
    config: {
      clientId: "cid",
      clientSecret: "csec",
      apiVersion: "202511",
      publicArchiveBaseUrl: "https://news.example.com",
    },
    logger: makeLogger(),
    now: () => NOW,
  });
  return { notifier, deps };
}

describe("createLinkedInNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: composes, posts, marks linkedin_posted_at + permalink (REQ-023)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: { ok: true, postUrn: "urn:li:share:1234" },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: "urn:li:share:1234" });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
    const callArg = deps.apiClient.createPost.mock.calls[0][0];
    expect(callArg.accessToken).toBe("access-1");
    expect(callArg.personUrn).toBe("urn:li:person:abc");
    expect(callArg.apiVersion).toBe("202511");
    expect(callArg.text).toContain("Hook line for social.");
    expect(callArg.text).toContain("→ Story 1 summary body.");
    // Body ends with the LinkedIn footer pointing at the follow-up comment.
    expect(callArg.text).toContain("Full newsletter linked in the comments.");
    expect(callArg.text).not.toContain("https://");

    expect(deps.apiClient.createComment).toHaveBeenCalledTimes(1);
    const commentArg = deps.apiClient.createComment.mock.calls[0][0];
    expect(commentArg.accessToken).toBe("access-1");
    expect(commentArg.personUrn).toBe("urn:li:person:abc");
    expect(commentArg.postUrn).toBe("urn:li:share:1234");
    expect(commentArg.apiVersion).toBe("202511");
    expect(commentArg.text).toBe(
      `https://news.example.com/archive/${RUN_ID}`,
    );

    expect(deps.archives.markLinkedInPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "urn:li:share:1234",
    );
  });

  it("comment failure: post is still treated as posted, no recordSocialFailure called", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: { ok: true, postUrn: "urn:li:share:abcd" },
    });
    deps.apiClient.createComment.mockResolvedValueOnce({
      ok: false,
      status: 429,
      body: "rate limited",
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: "urn:li:share:abcd" });
    expect(deps.apiClient.createComment).toHaveBeenCalledTimes(1);
    expect(deps.archives.markLinkedInPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "urn:li:share:abcd",
    );
    expect(deps.archives.recordSocialFailure).not.toHaveBeenCalled();
  });

  it("duplicate post (422): does not post a comment, still marks posted with null permalink", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: {
        ok: false,
        status: 422,
        body: '{"errorDetails":{"inputErrors":[{"code":"DUPLICATE_POST"}]}}',
        errorCode: "DUPLICATE_POST",
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: null });
    expect(deps.apiClient.createComment).not.toHaveBeenCalled();
  });

  it("idempotency: skipped when linkedinPostedAt is set, no api call (REQ-022)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ linkedinPostedAt: NOW }),
      tokenRow: makeTokenRow(),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "already_posted" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
    expect(deps.tokens.withTokenLock).not.toHaveBeenCalled();
  });

  it("null hook → posts with DEFAULT_LINKEDIN_HOOK as header", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ hook: null }),
      tokenRow: makeTokenRow(),
      postResult: { ok: true, postUrn: "urn:li:share:default" },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: "urn:li:share:default" });
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
    const callArg = deps.apiClient.createPost.mock.calls[0][0];
    expect(callArg.text.startsWith("AgentLoop — Today in Agentic Engineering\n\n")).toBe(
      true,
    );
  });

  it("no stories → skipped no_headline", async () => {
    const { notifier, deps } = build({
      archive: makeArchive({ rankedItems: [] }),
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

  it("token row missing → skipped no_token, no api call (EDGE-010)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: null,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "no_token" });
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("token expired → calls refreshFn, saves new token, uses new access token (REQ-034)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow({ expiresAt: PAST }),
      refreshResult: {
        ok: true,
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresAt: FUTURE,
      },
      postResult: { ok: true, postUrn: "urn:li:share:42" },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: "urn:li:share:42" });
    expect(deps.refreshFn).toHaveBeenCalledTimes(1);
    expect(deps.saveTokenSpy).toHaveBeenCalledWith("linkedin", {
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresAt: FUTURE,
      metadata: { personUrn: "urn:li:person:abc" },
    });
    expect(deps.apiClient.createPost.mock.calls[0][0].accessToken).toBe(
      "fresh-access",
    );
  });

  it("refreshFn returns ok:false → failed, no api call (REQ-035)", async () => {
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

  it("apiClient returns 422 DUPLICATE_POST → marks posted with null permalink (REQ-025)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: {
        ok: false,
        status: 422,
        body: '{"errorDetails":{"inputErrors":[{"code":"DUPLICATE_POST"}]}}',
        errorCode: "DUPLICATE_POST",
      },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "posted", permalink: null });
    expect(deps.archives.markLinkedInPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      null,
    );
    expect(deps.archives.recordSocialFailure).not.toHaveBeenCalled();
  });

  it("apiClient returns 401 twice → forces refresh, retries once, records final failure (REQ-024)", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
    });
    // Both attempts fail with 401.
    deps.apiClient.createPost
      .mockResolvedValueOnce({ ok: false, status: 401, body: "unauthorized" })
      .mockResolvedValueOnce({ ok: false, status: 401, body: "unauthorized" });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "http_401" });
    expect(deps.refreshFn).toHaveBeenCalledTimes(1);
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
    expect(deps.archives.recordSocialFailure).toHaveBeenCalledWith(
      RUN_ID,
      "linkedin",
      "401:unauthorized",
    );
    expect(deps.archives.markLinkedInPosted).not.toHaveBeenCalled();
  });

  it.each([
    { status: 401, body: "unauthorized", postUrn: "urn:li:share:retry-1" },
    { status: 403, body: "forbidden", postUrn: "urn:li:share:retry-2" },
  ])(
    "apiClient returns $status then ok → forces refresh, retry succeeds, marks posted",
    async ({ status, body, postUrn }) => {
      const { notifier, deps } = build({
        archive: makeArchive(),
        tokenRow: makeTokenRow(), // DB says still-valid (FUTURE)
      });
      deps.apiClient.createPost
        .mockResolvedValueOnce({ ok: false, status, body })
        .mockResolvedValueOnce({ ok: true, postUrn });

      const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

      expect(result).toEqual({ status: "posted", permalink: postUrn });
      expect(deps.refreshFn).toHaveBeenCalledTimes(1);
      expect(deps.apiClient.createPost).toHaveBeenCalledTimes(2);
      expect(deps.apiClient.createPost.mock.calls[0][0].accessToken).toBe(
        "access-1",
      );
      expect(deps.apiClient.createPost.mock.calls[1][0].accessToken).toBe(
        "access-2",
      );
      expect(deps.archives.markLinkedInPosted).toHaveBeenCalledTimes(1);
      expect(deps.archives.recordSocialFailure).not.toHaveBeenCalled();
    },
  );

  it("apiClient returns non-auth error (500) → no retry", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postResult: { ok: false, status: 500, body: "server error" },
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "http_500" });
    expect(deps.refreshFn).not.toHaveBeenCalled();
    expect(deps.apiClient.createPost).toHaveBeenCalledTimes(1);
  });

  it("token has empty refresh_token (app missing programmatic refresh) → bails with refresh_unavailable on expiry", async () => {
    const { notifier, deps } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow({ refreshToken: "", expiresAt: PAST }),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "refresh_unavailable" });
    expect(deps.refreshFn).not.toHaveBeenCalled();
    expect(deps.apiClient.createPost).not.toHaveBeenCalled();
  });

  it("apiClient throws unexpectedly → caught, returns failed/unexpected; never throws (REQ-026)", async () => {
    const { notifier } = build({
      archive: makeArchive(),
      tokenRow: makeTokenRow(),
      postThrows: new Error("boom"),
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "unexpected" });
  });
});
