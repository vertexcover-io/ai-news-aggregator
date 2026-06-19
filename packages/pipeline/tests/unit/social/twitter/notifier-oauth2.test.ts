/**
 * P13 (REQ-081): per-tenant Twitter OAuth2 posting path.
 *
 * The notifier acquires the TENANT's OAuth2 token under a `FOR UPDATE` lock
 * (withTokenLock — mirror of the D-109 LinkedIn pattern), refreshes it when
 * expired, and posts via a client built from the tenant access token. All
 * provider interaction is mocked — no live tweet, ever.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type {
  SaveSocialTokenInput,
  SocialTokenRow,
  SocialTokensRepo,
  SocialTokensTx,
} from "../../../../src/repositories/social-tokens.js";
import type { refreshTwitterToken } from "../../../../src/social/twitter/oauth.js";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-05-11T12:00:00.000Z");
const FUTURE = new Date("2026-05-11T14:00:00.000Z");
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

function makeArchive(): PipelineRunArchiveRow {
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
  } as PipelineRunArchiveRow;
}

function tokenRow(overrides: Partial<SocialTokenRow> = {}): SocialTokenRow {
  return {
    platform: "twitter",
    accessToken: "tenant-at-1",
    refreshToken: "tenant-rt-1",
    expiresAt: FUTURE,
    metadata: null,
    updatedAt: NOW,
    ...overrides,
  };
}

interface TokensFake {
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  saved: { platform: string; input: SaveSocialTokenInput }[];
  lockCalls: number;
}

function makeTokens(initial: SocialTokenRow | null): TokensFake {
  const saved: TokensFake["saved"] = [];
  let current = initial;
  const fake: TokensFake = {
    saved,
    lockCalls: 0,
    tokens: {
      async withTokenLock<T>(
        _platform: "linkedin" | "twitter",
        fn: (row: SocialTokenRow | null, tx: SocialTokensTx) => Promise<T>,
      ): Promise<T> {
        fake.lockCalls += 1;
        const tx: SocialTokensTx = {
          saveToken(p, inp): Promise<void> {
            saved.push({ platform: p, input: inp });
            current = current === null ? null : { ...current, ...inp };
            return Promise.resolve();
          },
        };
        return fn(current, tx);
      },
    },
  };
  return fake;
}

interface ClientFake {
  clientFactory: (accessToken: string) => TwitterApiClient;
  /** Access tokens the factory was called with, in order. */
  factoryTokens: string[];
  /** createPost invocations as { accessToken, text }. */
  posts: { accessToken: string; text: string }[];
}

function makeClientFactory(
  resultFor: (accessToken: string, callIndex: number) => TwitterCreatePostResult,
): ClientFake {
  const factoryTokens: string[] = [];
  const posts: ClientFake["posts"] = [];
  let postCall = 0;
  return {
    factoryTokens,
    posts,
    clientFactory: (accessToken: string): TwitterApiClient => {
      factoryTokens.push(accessToken);
      return {
        createPost(input): Promise<TwitterCreatePostResult> {
          posts.push({ accessToken, text: input.text });
          const result = resultFor(accessToken, postCall);
          postCall += 1;
          return Promise.resolve(result);
        },
        validateCredentials: vi.fn(),
      };
    },
  };
}

const POST_OK: TwitterCreatePostResult = {
  ok: true,
  tweetId: "999",
  tweetUrl: "https://x.com/i/status/999",
};

interface BuildResult {
  notifier: ReturnType<typeof createTwitterNotifier>;
  archives: {
    findById: ReturnType<typeof vi.fn>;
    markTwitterPosted: ReturnType<typeof vi.fn>;
    recordSocialFailure: ReturnType<typeof vi.fn>;
  };
}

function build(opts: {
  tokens: TokensFake;
  client: ClientFake;
  refreshFn?: typeof refreshTwitterToken;
}): BuildResult {
  const archives = {
    findById: vi.fn().mockResolvedValue(makeArchive()),
    markTwitterPosted: vi.fn().mockResolvedValue(undefined),
    recordSocialFailure: vi.fn().mockResolvedValue(undefined),
  };
  const notifier = createTwitterNotifier({
    oauth2: {
      tokens: opts.tokens.tokens,
      clientId: "app-client-id",
      clientSecret: "app-client-secret",
      refreshFn: opts.refreshFn,
      clientFactory: opts.client.clientFactory,
    },
    archives: archives as unknown as Pick<
      RunArchivesRepo,
      "findById" | "markTwitterPosted" | "recordSocialFailure"
    >,
    rawItems: { findByIds: vi.fn().mockResolvedValue([]) },
    config: {
      publicArchiveBaseUrl: "https://news.example.com",
      twitterIsPremium: false,
    },
    logger: makeLogger(),
    now: () => NOW,
  });
  return { notifier, archives };
}

describe("createTwitterNotifier — OAuth2 tenant-token path (REQ-081)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test_REQ_081_publish_uses_tenant_tokens — posts via a client built from the tenant's access token; no refresh when fresh", async () => {
    const tokens = makeTokens(tokenRow());
    const client = makeClientFactory(() => POST_OK);
    const refreshFn = vi.fn();
    const { notifier, archives } = build({
      tokens,
      client,
      refreshFn: refreshFn as unknown as typeof refreshTwitterToken,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result.status).toBe("posted");
    // The client was built from the TENANT's access token...
    expect(client.factoryTokens).toEqual(["tenant-at-1"]);
    // ...and both the head tweet and the link reply used it.
    expect(client.posts).toHaveLength(2);
    expect(client.posts[0].accessToken).toBe("tenant-at-1");
    expect(client.posts[1].accessToken).toBe("tenant-at-1");
    // Fresh token → no refresh, no token write; acquired under the lock.
    expect(refreshFn).not.toHaveBeenCalled();
    expect(tokens.saved).toHaveLength(0);
    expect(tokens.lockCalls).toBe(1);
    expect(archives.markTwitterPosted).toHaveBeenCalledWith(
      RUN_ID,
      NOW,
      "https://x.com/i/status/999",
      ["999", "999"],
    );
  });

  it("expired token → refreshes under the lock, persists the rotated tokens via tx, posts with the NEW access token", async () => {
    const tokens = makeTokens(tokenRow({ expiresAt: PAST }));
    const client = makeClientFactory(() => POST_OK);
    const refreshFn = vi.fn().mockResolvedValue({
      ok: true,
      accessToken: "tenant-at-2",
      refreshToken: "tenant-rt-2",
      expiresAt: FUTURE,
    });
    const { notifier } = build({
      tokens,
      client,
      refreshFn: refreshFn as unknown as typeof refreshTwitterToken,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result.status).toBe("posted");
    expect(refreshFn).toHaveBeenCalledWith({
      clientId: "app-client-id",
      clientSecret: "app-client-secret",
      refreshToken: "tenant-rt-1",
    });
    // Rotated tokens persisted INSIDE the lock transaction.
    expect(tokens.saved).toHaveLength(1);
    expect(tokens.saved[0].platform).toBe("twitter");
    expect(tokens.saved[0].input.accessToken).toBe("tenant-at-2");
    expect(tokens.saved[0].input.refreshToken).toBe("tenant-rt-2");
    // The post used the refreshed access token.
    expect(client.factoryTokens).toEqual(["tenant-at-2"]);
    expect(client.posts[0].accessToken).toBe("tenant-at-2");
  });

  it("reactive auth retry: 401 on post → forced refresh under a second lock → retried once with the new token", async () => {
    const tokens = makeTokens(tokenRow());
    // First head-post attempt 401s; subsequent posts succeed.
    const client = makeClientFactory((_token, callIndex) =>
      callIndex === 0 ? { ok: false, status: 401, body: "unauthorized" } : POST_OK,
    );
    const refreshFn = vi.fn().mockResolvedValue({
      ok: true,
      accessToken: "tenant-at-3",
      refreshToken: "tenant-rt-3",
      expiresAt: FUTURE,
    });
    const { notifier } = build({
      tokens,
      client,
      refreshFn: refreshFn as unknown as typeof refreshTwitterToken,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result.status).toBe("posted");
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(tokens.lockCalls).toBe(2);
    // First client from the stale token, retry client from the refreshed one.
    expect(client.factoryTokens).toEqual(["tenant-at-1", "tenant-at-3"]);
    expect(client.posts[1].accessToken).toBe("tenant-at-3");
  });

  it("no token row → skipped with reason no_token (channel skips; run unaffected)", async () => {
    const tokens = makeTokens(null);
    const client = makeClientFactory(() => POST_OK);
    const { notifier } = build({ tokens, client });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "skipped", reason: "no_token" });
    expect(client.posts).toHaveLength(0);
  });

  it("expired token with empty refresh-token sentinel → failed refresh_unavailable; nothing posted", async () => {
    const tokens = makeTokens(tokenRow({ expiresAt: PAST, refreshToken: "" }));
    const client = makeClientFactory(() => POST_OK);
    const refreshFn = vi.fn();
    const { notifier } = build({
      tokens,
      client,
      refreshFn: refreshFn as unknown as typeof refreshTwitterToken,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "refresh_unavailable" });
    expect(refreshFn).not.toHaveBeenCalled();
    expect(client.posts).toHaveLength(0);
  });

  it("refresh failure → failed refresh_failed; nothing posted, no token write", async () => {
    const tokens = makeTokens(tokenRow({ expiresAt: PAST }));
    const client = makeClientFactory(() => POST_OK);
    const refreshFn = vi.fn().mockResolvedValue({ ok: false, status: 400, body: "bad" });
    const { notifier } = build({
      tokens,
      client,
      refreshFn: refreshFn as unknown as typeof refreshTwitterToken,
    });

    const result = await notifier.notifyArchiveReady({ runId: RUN_ID });

    expect(result).toEqual({ status: "failed", reason: "refresh_failed" });
    expect(tokens.saved).toHaveLength(0);
    expect(client.posts).toHaveLength(0);
  });
});
