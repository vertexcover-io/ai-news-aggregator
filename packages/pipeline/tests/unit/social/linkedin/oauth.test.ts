import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshLinkedInToken } from "../../../../src/social/linkedin/oauth.js";

const INPUT = {
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "old-refresh",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("refreshLinkedInToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses access_token, refresh_token, and computes expiresAt", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );

    const result = await refreshLinkedInToken(INPUT, fetchFn);

    expect(result).toEqual({
      ok: true,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: new Date("2026-05-11T01:00:00.000Z"),
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("old-refresh");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("csec");
  });

  it("reuses input refresh token when response omits refresh_token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "new-access", expires_in: 7200 }),
    );

    const result = await refreshLinkedInToken(INPUT, fetchFn);

    expect(result).toEqual({
      ok: true,
      accessToken: "new-access",
      refreshToken: "old-refresh",
      expiresAt: new Date("2026-05-11T02:00:00.000Z"),
    });
  });

  it("returns ok:false on non-2xx", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("invalid_grant", { status: 400 }));

    const result = await refreshLinkedInToken(INPUT, fetchFn);

    expect(result).toEqual({ ok: false, status: 400, body: "invalid_grant" });
  });

  it("returns status 0 on network throw", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await refreshLinkedInToken(INPUT, fetchFn);

    expect(result).toEqual({ ok: false, status: 0, body: "ETIMEDOUT" });
  });
});
