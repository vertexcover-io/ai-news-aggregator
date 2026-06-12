import { describe, it, expect, vi } from "vitest";
import {
  createTwitterOAuthService,
  resolveTwitterOAuthAppCreds,
  TWITTER_OAUTH_SCOPES,
  type TwitterApiCtorLike,
  type TwitterApiOAuth2Like,
} from "../twitter-oauth.js";

const NOW = new Date("2026-06-11T12:00:00.000Z");
const CREDS = { clientId: "app-client-id", clientSecret: "app-client-secret" };

function makeCtor(impl: Partial<TwitterApiOAuth2Like>): {
  Ctor: TwitterApiCtorLike;
  ctorCalls: { clientId: string; clientSecret: string }[];
} {
  const ctorCalls: { clientId: string; clientSecret: string }[] = [];
  class FakeTwitterApi {
    constructor(creds: { clientId: string; clientSecret: string }) {
      ctorCalls.push(creds);
    }
    generateOAuth2AuthLink = impl.generateOAuth2AuthLink ?? vi.fn();
    loginWithOAuth2 = impl.loginWithOAuth2 ?? vi.fn();
    refreshOAuth2Token = impl.refreshOAuth2Token ?? vi.fn();
  }
  return { Ctor: FakeTwitterApi as unknown as TwitterApiCtorLike, ctorCalls };
}

describe("resolveTwitterOAuthAppCreds", () => {
  it("returns creds when both env vars set; null otherwise", () => {
    expect(
      resolveTwitterOAuthAppCreds({
        TWITTER_OAUTH_CLIENT_ID: "a",
        TWITTER_OAUTH_CLIENT_SECRET: "b",
      }),
    ).toEqual({ clientId: "a", clientSecret: "b" });
    expect(resolveTwitterOAuthAppCreds({})).toBeNull();
    expect(
      resolveTwitterOAuthAppCreds({ TWITTER_OAUTH_CLIENT_ID: "a" }),
    ).toBeNull();
    expect(
      resolveTwitterOAuthAppCreds({
        TWITTER_OAUTH_CLIENT_ID: "",
        TWITTER_OAUTH_CLIENT_SECRET: "b",
      }),
    ).toBeNull();
  });
});

describe("createTwitterOAuthService", () => {
  it("generateAuthLink: passes the OAuth2 PKCE scopes and returns url/state/codeVerifier", () => {
    const generateOAuth2AuthLink = vi.fn().mockReturnValue({
      url: "https://twitter.com/i/oauth2/authorize?state=st-1",
      state: "st-1",
      codeVerifier: "cv-1",
    });
    const { Ctor, ctorCalls } = makeCtor({ generateOAuth2AuthLink });
    const svc = createTwitterOAuthService(CREDS, { TwitterApiCtor: Ctor });

    const link = svc.generateAuthLink("https://app.example/callback");

    expect(ctorCalls).toEqual([CREDS]);
    expect(generateOAuth2AuthLink).toHaveBeenCalledWith(
      "https://app.example/callback",
      { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] },
    );
    expect(link).toEqual({
      url: "https://twitter.com/i/oauth2/authorize?state=st-1",
      state: "st-1",
      codeVerifier: "cv-1",
    });
  });

  it("scopes include offline.access (refresh tokens) — REQ-081", () => {
    expect(TWITTER_OAUTH_SCOPES).toContain("offline.access");
  });

  it("exchangeCode: maps loginWithOAuth2 to a token set with expiry and @handle", async () => {
    const loginWithOAuth2 = vi.fn().mockResolvedValue({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresIn: 7200,
      client: {
        v2: {
          me: vi
            .fn()
            .mockResolvedValue({ data: { username: "agentloop", name: "Agent Loop" } }),
        },
      },
    });
    const { Ctor } = makeCtor({ loginWithOAuth2 });
    const svc = createTwitterOAuthService(CREDS, {
      TwitterApiCtor: Ctor,
      now: () => NOW,
    });

    const result = await svc.exchangeCode({
      code: "code-1",
      codeVerifier: "cv-1",
      redirectUri: "https://app.example/callback",
    });

    expect(loginWithOAuth2).toHaveBeenCalledWith({
      code: "code-1",
      codeVerifier: "cv-1",
      redirectUri: "https://app.example/callback",
    });
    expect(result).toEqual({
      ok: true,
      tokens: {
        accessToken: "at-1",
        refreshToken: "rt-1",
        expiresAt: new Date(NOW.getTime() + 7200 * 1000),
        connectedAs: "@agentloop",
      },
    });
  });

  it("exchangeCode: missing refresh token → null; failed profile lookup is non-fatal", async () => {
    const loginWithOAuth2 = vi.fn().mockResolvedValue({
      accessToken: "at-1",
      expiresIn: 7200,
      client: { v2: { me: vi.fn().mockRejectedValue(new Error("403")) } },
    });
    const { Ctor } = makeCtor({ loginWithOAuth2 });
    const svc = createTwitterOAuthService(CREDS, {
      TwitterApiCtor: Ctor,
      now: () => NOW,
    });

    const result = await svc.exchangeCode({
      code: "c",
      codeVerifier: "v",
      redirectUri: "r",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.refreshToken).toBeNull();
      expect(result.tokens.connectedAs).toBeNull();
    }
  });

  it("exchangeCode: loginWithOAuth2 rejection → { ok: false, detail }", async () => {
    const loginWithOAuth2 = vi
      .fn()
      .mockRejectedValue(new Error("invalid_request"));
    const { Ctor } = makeCtor({ loginWithOAuth2 });
    const svc = createTwitterOAuthService(CREDS, { TwitterApiCtor: Ctor });

    const result = await svc.exchangeCode({
      code: "bad",
      codeVerifier: "v",
      redirectUri: "r",
    });

    expect(result).toEqual({ ok: false, detail: "invalid_request" });
  });

  it("refreshToken: maps refreshOAuth2Token including the ROTATED refresh token", async () => {
    const refreshOAuth2Token = vi.fn().mockResolvedValue({
      accessToken: "at-2",
      refreshToken: "rt-rotated",
      expiresIn: 7200,
    });
    const { Ctor } = makeCtor({ refreshOAuth2Token });
    const svc = createTwitterOAuthService(CREDS, {
      TwitterApiCtor: Ctor,
      now: () => NOW,
    });

    const result = await svc.refreshToken("rt-old");

    expect(refreshOAuth2Token).toHaveBeenCalledWith("rt-old");
    expect(result).toEqual({
      ok: true,
      tokens: {
        accessToken: "at-2",
        refreshToken: "rt-rotated",
        expiresAt: new Date(NOW.getTime() + 7200 * 1000),
      },
    });
  });

  it("refreshToken: rejection → { ok: false, detail }", async () => {
    const refreshOAuth2Token = vi
      .fn()
      .mockRejectedValue(new Error("invalid_grant"));
    const { Ctor } = makeCtor({ refreshOAuth2Token });
    const svc = createTwitterOAuthService(CREDS, { TwitterApiCtor: Ctor });

    expect(await svc.refreshToken("rt-old")).toEqual({
      ok: false,
      detail: "invalid_grant",
    });
  });
});
