import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildLinkedInAuthorizeUrl,
  buildTwitterAuthorizeUrl,
  generatePkcePair,
  parseTokenResponse,
} from "../../../src/social/cli-helpers.js";

describe("buildLinkedInAuthorizeUrl", () => {
  it("includes all expected query params", () => {
    const url = buildLinkedInAuthorizeUrl({
      clientId: "abc 123",
      redirectUri: "http://127.0.0.1:8765/callback",
      state: "xyz",
      scope: "openid profile email w_member_social",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("abc 123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:8765/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("xyz");
    expect(parsed.searchParams.get("scope")).toBe(
      "openid profile email w_member_social",
    );
  });
});

describe("buildTwitterAuthorizeUrl", () => {
  it("includes PKCE params", () => {
    const url = buildTwitterAuthorizeUrl({
      clientId: "twcid",
      redirectUri: "http://127.0.0.1:8765/callback",
      state: "st",
      scope: "tweet.read tweet.write users.read offline.access",
      codeChallenge: "challenge-value",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://twitter.com/i/oauth2/authorize",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("twcid");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:8765/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("st");
    expect(parsed.searchParams.get("scope")).toBe(
      "tweet.read tweet.write users.read offline.access",
    );
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("generatePkcePair", () => {
  it("produces a valid codeVerifier and matching sha256 codeChallenge", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);

    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(codeChallenge).toBe(expected);

    // base64url decode → 32 bytes
    const padded =
      codeChallenge.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (codeChallenge.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64");
    expect(decoded.length).toBe(32);
  });
});

describe("parseTokenResponse", () => {
  it("extracts fields when valid", () => {
    const before = Date.now();
    const result = parseTokenResponse({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 50);
  });

  it("returns error when access_token missing", () => {
    const result = parseTokenResponse({ expires_in: 3600 });
    expect("error" in result).toBe(true);
  });

  it("returns null refreshToken when refresh_token absent", () => {
    const result = parseTokenResponse({
      access_token: "at",
      expires_in: 3600,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.refreshToken).toBeNull();
  });
});
