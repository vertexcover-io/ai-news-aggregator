import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  parseTokenResponse,
} from "../linkedin-oauth.js";

// VS-0a / REQ-001: buildAuthorizeUrl produces a correctly shaped LinkedIn authorize URL.
describe("buildAuthorizeUrl", () => {
  it("produces a URL with response_type=code", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "test-client-id",
        redirectUri: "https://example.com/callback",
        state: "random-state-value",
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("embeds client_id", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "my-client-id",
        redirectUri: "https://example.com/callback",
        state: "s1",
      }),
    );
    expect(url.searchParams.get("client_id")).toBe("my-client-id");
  });

  it("embeds the exact redirect_uri", () => {
    const redirectUri =
      "https://agentloop.vertexcover.io/api/admin/social-credentials/linkedin/oauth/callback";
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri,
        state: "s1",
      }),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });

  it("embeds the scope openid profile email w_member_social", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://example.com/cb",
        state: "s1",
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email w_member_social",
    );
  });

  it("embeds the provided state", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://example.com/cb",
        state: "csrf-token-abc123",
      }),
    );
    expect(url.searchParams.get("state")).toBe("csrf-token-abc123");
  });

  it("sets prompt=login so Reconnect re-runs login/consent (account switch)", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://example.com/cb",
        state: "s1",
      }),
    );
    expect(url.searchParams.get("prompt")).toBe("login");
  });

  it("uses the LinkedIn authorization endpoint as the base URL", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://example.com/cb",
        state: "s1",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
  });
});

// VS-0b / REQ-014: parseTokenResponse extracts tokens and handles missing refresh_token.
describe("parseTokenResponse", () => {
  it("extracts access_token, refresh_token, and expiresAt", () => {
    const result = parseTokenResponse({
      access_token: "at-value",
      refresh_token: "rt-value",
      expires_in: 3600,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.accessToken).toBe("at-value");
    expect(result.refreshToken).toBe("rt-value");
    expect(result.expiresAt).toBeInstanceOf(Date);
    // expiresAt is roughly now + 3600s
    const diff = result.expiresAt.getTime() - Date.now();
    expect(diff).toBeGreaterThan(3500 * 1000);
    expect(diff).toBeLessThan(3700 * 1000);
  });

  it("missing refresh_token → refreshToken is null (no throw)", () => {
    const result = parseTokenResponse({
      access_token: "at-value",
      expires_in: 3600,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.refreshToken).toBeNull();
  });

  it("empty string refresh_token → refreshToken is null", () => {
    const result = parseTokenResponse({
      access_token: "at-value",
      refresh_token: "",
      expires_in: 3600,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.refreshToken).toBeNull();
  });

  it("missing access_token → returns an error object", () => {
    const result = parseTokenResponse({ expires_in: 3600 });
    expect("error" in result).toBe(true);
  });

  it("non-object input → returns an error object", () => {
    const result = parseTokenResponse("not-an-object");
    expect("error" in result).toBe(true);
  });

  it("missing expires_in → returns an error object", () => {
    const result = parseTokenResponse({ access_token: "at" });
    expect("error" in result).toBe(true);
  });
});
