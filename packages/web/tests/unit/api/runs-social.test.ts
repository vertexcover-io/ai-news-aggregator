import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerSocialPost } from "../../../src/api/runs";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("triggerSocialPost (REQ-001 client side, REQ-013)", () => {
  it("POSTs to /api/runs/:runId/post/linkedin and resolves void on 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(
      triggerSocialPost("run-abc", "linkedin"),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/run-abc/post/linkedin");
    expect(init.method).toBe("POST");
  });

  it("POSTs to /api/runs/:runId/post/twitter and resolves void on 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(
      triggerSocialPost("run-xyz", "twitter"),
    ).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/run-xyz/post/twitter");
  });

  it("throws Error with server error message on non-2xx (409)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "already posted" }), {
        status: 409,
      }),
    );
    await expect(triggerSocialPost("run-abc", "linkedin")).rejects.toThrow(
      "already posted",
    );
  });

  it("throws fallback Error when non-2xx body has no error field", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 404 }),
    );
    await expect(triggerSocialPost("run-abc", "twitter")).rejects.toThrow(
      "Failed to trigger social post",
    );
  });
});
