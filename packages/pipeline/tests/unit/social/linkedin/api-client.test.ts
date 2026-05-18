import { describe, expect, it, vi } from "vitest";

import { createLinkedInApiClient } from "../../../../src/social/linkedin/api-client.js";

const INPUT = {
  accessToken: "tok",
  personUrn: "urn:li:person:abc",
  text: "hello world",
  apiVersion: "202511",
};

function makeResponse(args: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  return new Response(args.body ?? "", {
    status: args.status,
    headers: args.headers ?? {},
  });
}

describe("createLinkedInApiClient", () => {
  it("returns postUrn on 201 when x-restli-id contains numeric id only", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse({ status: 201, headers: { "x-restli-id": "12345" } }),
    );
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({ ok: true, postUrn: "urn:li:share:12345" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["LinkedIn-Version"]).toBe("202511");
    expect(headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(headers["Content-Type"]).toBe("application/json");
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody.author).toBe("urn:li:person:abc");
    expect(sentBody.commentary).toBe("hello world");
    expect(sentBody.visibility).toBe("PUBLIC");
    expect(sentBody.lifecycleState).toBe("PUBLISHED");
  });

  it("passes through full URN when x-restli-id already contains it", async () => {
    // Production LinkedIn now returns the full urn:li:share:<id> in the header.
    // Ensure we don't double-prefix it.
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse({
        status: 201,
        headers: { "x-restli-id": "urn:li:share:7459582142512033793" },
      }),
    );
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({
      ok: true,
      postUrn: "urn:li:share:7459582142512033793",
    });
  });

  it("returns ok:false with status 401", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 401, body: "unauthorized" }));
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({ ok: false, status: 401, body: "unauthorized" });
  });

  it("surfaces DUPLICATE_POST errorCode on 422", async () => {
    const errBody = JSON.stringify({
      errorDetails: { inputErrors: [{ code: "DUPLICATE_POST" }] },
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 422, body: errBody }));
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({
      ok: false,
      status: 422,
      body: errBody,
      errorCode: "DUPLICATE_POST",
    });
  });

  it("returns ok:false without errorCode for sunset 400 body", async () => {
    const sunsetBody = "API version sunset";
    const fetchFn = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 400, body: sunsetBody }));
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({ ok: false, status: 400, body: sunsetBody });
    expect("errorCode" in result && result.errorCode).toBeFalsy();
  });

  it("returns status 0 sentinel on fetch throw", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = createLinkedInApiClient({ fetchFn });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({ ok: false, status: 0, body: "ECONNRESET" });
  });

  describe("createComment", () => {
    const COMMENT_INPUT = {
      accessToken: "tok",
      personUrn: "urn:li:person:abc",
      postUrn: "urn:li:share:7459582142512033793",
      text: "Full breakdown: https://news.example.com/archive/abc",
      apiVersion: "202511",
    };

    it("posts to socialActions/{postUrn}/comments with actor/object/message body and returns ok on 201", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(makeResponse({ status: 201 }));
      const client = createLinkedInApiClient({ fetchFn });

      const result = await client.createComment(COMMENT_INPUT);

      expect(result).toEqual({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      // Post URN must be URL-encoded in the path since it contains colons.
      expect(url).toBe(
        `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(COMMENT_INPUT.postUrn)}/comments`,
      );
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok");
      expect(headers["LinkedIn-Version"]).toBe("202511");
      expect(headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
      expect(headers["Content-Type"]).toBe("application/json");
      const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(sentBody.actor).toBe("urn:li:person:abc");
      expect(sentBody.object).toBe(COMMENT_INPUT.postUrn);
      expect(sentBody.message).toEqual({ text: COMMENT_INPUT.text });
    });

    it("returns ok:false with status and body on non-201", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(makeResponse({ status: 403, body: "forbidden" }));
      const client = createLinkedInApiClient({ fetchFn });

      const result = await client.createComment(COMMENT_INPUT);

      expect(result).toEqual({ ok: false, status: 403, body: "forbidden" });
    });

    it("returns status 0 sentinel on fetch throw", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const client = createLinkedInApiClient({ fetchFn });

      const result = await client.createComment(COMMENT_INPUT);

      expect(result).toEqual({ ok: false, status: 0, body: "ECONNRESET" });
    });
  });
});
