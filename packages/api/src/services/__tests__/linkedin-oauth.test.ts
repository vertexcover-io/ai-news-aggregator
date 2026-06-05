import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  parseTokenResponse,
} from "../linkedin-oauth.js";

// VS-0a / REQ-001: buildAuthorizeUrl produces a correctly shaped LinkedIn authorize URL.
describe("buildAuthorizeUrl", () => {
  const redirectUri =
    "https://agentloop.vertexcover.io/api/admin/social-credentials/linkedin/oauth/callback";

  it("builds the full LinkedIn authorize URL with all expected params", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "test-client-id",
        redirectUri,
        state: "csrf-token-abc123",
      }),
    );
    // Base endpoint.
    expect(url.origin + url.pathname).toBe(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
    // Each query param echoed verbatim from the inputs / fixed scope+prompt.
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email w_member_social",
    );
    expect(url.searchParams.get("state")).toBe("csrf-token-abc123");
    // prompt=login so Reconnect re-runs login/consent (account switch).
    expect(url.searchParams.get("prompt")).toBe("login");
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

  it.each<{ name: string; input: unknown }>([
    { name: "missing access_token", input: { expires_in: 3600 } },
    { name: "non-object input", input: "not-an-object" },
    { name: "missing expires_in", input: { access_token: "at" } },
  ])("$name → returns an error object", ({ input }) => {
    const result = parseTokenResponse(input);
    expect("error" in result).toBe(true);
  });
});
