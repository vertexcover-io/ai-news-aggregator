import { describe, it, expect, vi } from "vitest";
import { postToWebhook } from "@shared/slack/webhook-client.js";

describe("postToWebhook", () => {
  it("returns ok when status is 200 and body is 'ok'", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const result = await postToWebhook({
      url: "https://hooks.slack.com/services/T/B/X",
      blocks: [{ type: "section" }],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      blocks: [{ type: "section" }],
    });
  });

  it("returns failure with status 200 when body is not 'ok'", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("invalid_blocks", { status: 200 })),
    );
    const result = await postToWebhook({
      url: "https://hooks.slack.com/services/T/B/X",
      blocks: [],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      status: 200,
      error: "invalid_blocks",
    });
  });

  it("returns failure with non-200 status and body", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("server", { status: 500 })),
    );
    const result = await postToWebhook({
      url: "https://hooks.slack.com/services/T/B/X",
      blocks: [],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, status: 500, error: "server" });
  });

  it("returns network failure when fetch throws", async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const result = await postToWebhook({
      url: "https://hooks.slack.com/services/T/B/X",
      blocks: [],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      status: "network",
      error: "fetch failed",
    });
  });
});
