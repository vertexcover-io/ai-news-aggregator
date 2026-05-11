import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshTwitterToken } from "../../../../src/social/twitter/oauth.js";

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

describe("refreshTwitterToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses tokens, computes expiresAt, and uses Basic auth + form body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );

    const result = await refreshTwitterToken(INPUT, fetchFn);

    expect(result).toEqual({
      ok: true,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: new Date("2026-05-11T01:00:00.000Z"),
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/oauth2/token");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const expectedAuth = `Basic ${Buffer.from("cid:csec").toString("base64")}`;
    expect(headers.Authorization).toBe(expectedAuth);
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("old-refresh");
    expect(params.get("client_id")).toBe("cid");
  });

  it("returns ok:false when response omits refresh_token (X requires rotation)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "new-access", expires_in: 7200 }),
    );

    const result = await refreshTwitterToken(INPUT, fetchFn);

    expect(result).toEqual({
      ok: false,
      status: 0,
      body: "missing refresh_token in response",
    });
  });

  it("returns ok:false on 400 unauthorized_client", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized_client", { status: 400 }));

    const result = await refreshTwitterToken(INPUT, fetchFn);

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: "unauthorized_client",
    });
  });

  it("returns ok:false on 401", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("invalid_token", { status: 401 }));

    const result = await refreshTwitterToken(INPUT, fetchFn);

    expect(result).toEqual({ ok: false, status: 401, body: "invalid_token" });
  });

  it("returns status 0 on network throw", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await refreshTwitterToken(INPUT, fetchFn);

    expect(result).toEqual({ ok: false, status: 0, body: "ETIMEDOUT" });
  });
});
