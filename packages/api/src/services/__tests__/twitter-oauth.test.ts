import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TwitterApi } from "twitter-api-v2";
import { buildTwitterOAuth2AuthLink, parseTwitterTokenResponse } from "../twitter-oauth.js";

// Mock twitter-api-v2
vi.mock("twitter-api-v2", () => ({
  TwitterApi: vi.fn(),
}));

const CALLBACK_URL = "https://example.com/api/admin/social-credentials/twitter/oauth/callback";

describe("buildTwitterOAuth2AuthLink", () => {
  beforeEach(() => {
    const mockGenerate = vi.fn().mockReturnValue({
      url: "https://twitter.com/i/oauth2/authorize?code_challenge=xx&state=st",
      codeVerifier: "cv-abc",
      state: "st-abc",
    });
    vi.mocked(TwitterApi).mockImplementation(() => ({
      generateOAuth2AuthLink: mockGenerate,
    }) as unknown as TwitterApi);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("calls generateOAuth2AuthLink with correct scopes including offline.access", () => {
    const result = buildTwitterOAuth2AuthLink({
      clientId: "tw-client-id",
      clientSecret: "tw-client-secret",
      redirectUri: CALLBACK_URL,
      TwitterApiCtor: TwitterApi,
    });

    expect(TwitterApi).toHaveBeenCalledWith({
      clientId: "tw-client-id",
      clientSecret: "tw-client-secret",
    });

    // The mock returns { url, codeVerifier, state }
    expect(result.url).toBe("https://twitter.com/i/oauth2/authorize?code_challenge=xx&state=st");
    expect(result.codeVerifier).toBe("cv-abc");
    expect(result.state).toBe("st-abc");

    // Verify the scopes were passed
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const mockGenerate = result.twitterApi.generateOAuth2AuthLink as ReturnType<typeof vi.fn>;
    expect(mockGenerate).toHaveBeenCalled();
    const [callbackUrl, opts] = mockGenerate.mock.calls[0] as [string, { scope: string[] }];
    expect(callbackUrl).toBe(CALLBACK_URL);
    expect(opts.scope).toContain("tweet.read");
    expect(opts.scope).toContain("tweet.write");
    expect(opts.scope).toContain("users.read");
    expect(opts.scope).toContain("offline.access");
  });
});

describe("parseTwitterTokenResponse", () => {
  it("extracts accessToken, refreshToken, and expiresAt from loginWithOAuth2 result", () => {
    const raw = {
      client: {} as TwitterApi,
      accessToken: "at-tw",
      refreshToken: "rt-tw",
      expiresIn: 7200,
    };
    const result = parseTwitterTokenResponse(raw);
    expect(result.accessToken).toBe("at-tw");
    expect(result.refreshToken).toBe("rt-tw");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("handles missing refreshToken", () => {
    const raw = {
      client: {} as TwitterApi,
      accessToken: "at-tw",
      refreshToken: undefined,
      expiresIn: 7200,
    };
    const result = parseTwitterTokenResponse(raw);
    expect(result.refreshToken).toBeNull();
  });
});
