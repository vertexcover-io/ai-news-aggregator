import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";

import type {
  SaveSocialTokenInput,
  SocialPlatform,
  SocialTokenRow,
  SocialTokensRepo,
  SocialTokensTx,
} from "@pipeline/repositories/social-tokens.js";
import { createOAuth2TwitterApiClient } from "@pipeline/social/twitter/oauth2-client.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";

const NOW = new Date("2026-06-11T12:00:00.000Z");

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function row(overrides: Partial<SocialTokenRow> = {}): SocialTokenRow {
  return {
    platform: "twitter",
    accessToken: "at-current",
    refreshToken: "rt-current",
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000), // fresh
    metadata: { name: "@agentloop" },
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTokens(initial: SocialTokenRow | null): {
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  saved: { platform: SocialPlatform; input: SaveSocialTokenInput }[];
} {
  const saved: { platform: SocialPlatform; input: SaveSocialTokenInput }[] = [];
  const tokens: Pick<SocialTokensRepo, "withTokenLock"> = {
    withTokenLock<T>(
      _platform: SocialPlatform,
      fn: (r: SocialTokenRow | null, tx: SocialTokensTx) => Promise<T>,
    ): Promise<T> {
      const tx: SocialTokensTx = {
        saveToken(platform, input): Promise<void> {
          saved.push({ platform, input });
          return Promise.resolve();
        },
      };
      return fn(initial, tx);
    },
  };
  return { tokens, saved };
}

function makeApiClient(): TwitterApiClient {
  return {
    createPost: vi.fn().mockResolvedValue({
      ok: true,
      tweetId: "t1",
      tweetUrl: "https://x.com/i/status/t1",
    }),
    validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const appClient = { clientId: "cid", clientSecret: "csecret" };

describe("createOAuth2TwitterApiClient", () => {
  it("uses the stored access token when not expired (no refresh, no save)", async () => {
    const { tokens, saved } = makeTokens(row());
    const inner = makeApiClient();
    const usedTokens: string[] = [];
    const refreshFn = vi.fn();
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient,
      logger: makeLogger(),
      clientFactory: (accessToken) => {
        usedTokens.push(accessToken);
        return inner;
      },
      refreshFn,
      now: () => NOW,
    });

    const result = await client.createPost({ text: "hello" });

    expect(result.ok).toBe(true);
    expect(usedTokens).toEqual(["at-current"]);
    expect(refreshFn).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("refreshes an expired token and persists the ROTATED refresh token atomically", async () => {
    const { tokens, saved } = makeTokens(
      row({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    const inner = makeApiClient();
    const usedTokens: string[] = [];
    const newExpiry = new Date(NOW.getTime() + 7200 * 1000);
    const refreshFn = vi.fn().mockResolvedValue({
      ok: true,
      accessToken: "at-new",
      refreshToken: "rt-rotated",
      expiresAt: newExpiry,
    });
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient,
      logger: makeLogger(),
      clientFactory: (accessToken) => {
        usedTokens.push(accessToken);
        return inner;
      },
      refreshFn,
      now: () => NOW,
    });

    const result = await client.createPost({ text: "hello" });

    expect(result.ok).toBe(true);
    expect(refreshFn).toHaveBeenCalledWith({
      clientId: "cid",
      clientSecret: "csecret",
      refreshToken: "rt-current",
    });
    expect(usedTokens).toEqual(["at-new"]);
    expect(saved).toEqual([
      {
        platform: "twitter",
        input: {
          accessToken: "at-new",
          refreshToken: "rt-rotated",
          expiresAt: newExpiry,
          metadata: { name: "@agentloop" },
        },
      },
    ]);
  });

  it("fails with the refresh status when the refresh request is rejected; nothing saved", async () => {
    const { tokens, saved } = makeTokens(
      row({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    const refreshFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, body: "invalid_grant" });
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient,
      logger: makeLogger(),
      clientFactory: () => makeApiClient(),
      refreshFn,
      now: () => NOW,
    });

    const result = await client.createPost({ text: "hello" });

    expect(result).toEqual({ ok: false, status: 400, body: "refresh_failed" });
    expect(saved).toEqual([]);
  });

  it("fails with refresh_unavailable when expired and no refresh token is stored", async () => {
    const { tokens } = makeTokens(
      row({ expiresAt: new Date(NOW.getTime() - 1000), refreshToken: "" }),
    );
    const refreshFn = vi.fn();
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient,
      logger: makeLogger(),
      clientFactory: () => makeApiClient(),
      refreshFn,
      now: () => NOW,
    });

    const result = await client.validateCredentials();

    expect(result).toEqual({
      ok: false,
      status: 401,
      body: "refresh_unavailable",
    });
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("fails with refresh_unavailable when expired and the OAuth2 app client is unset", async () => {
    const { tokens } = makeTokens(
      row({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient: null,
      logger: makeLogger(),
      clientFactory: () => makeApiClient(),
      refreshFn: vi.fn(),
      now: () => NOW,
    });

    const result = await client.createPost({ text: "x" });

    expect(result).toEqual({
      ok: false,
      status: 401,
      body: "refresh_unavailable",
    });
  });

  it("fails with no_token when the row vanished (e.g. disconnected mid-flight)", async () => {
    const { tokens } = makeTokens(null);
    const client = createOAuth2TwitterApiClient({
      tokens,
      appClient,
      logger: makeLogger(),
      clientFactory: () => makeApiClient(),
      refreshFn: vi.fn(),
      now: () => NOW,
    });

    const result = await client.createPost({ text: "x" });

    expect(result).toEqual({ ok: false, status: 401, body: "no_token" });
  });
});
