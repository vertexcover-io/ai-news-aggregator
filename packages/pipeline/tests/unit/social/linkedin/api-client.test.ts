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
  it("returns postUrn on 201 reading x-restli-id", async () => {
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
});
