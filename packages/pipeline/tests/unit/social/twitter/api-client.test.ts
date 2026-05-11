import { describe, expect, it, vi } from "vitest";
import type { TwitterApi } from "twitter-api-v2";

import { createTwitterApiClient } from "../../../../src/social/twitter/api-client.js";

const INPUT = { accessToken: "tok", text: "hello world" };

interface StubV2 {
  tweet: ReturnType<typeof vi.fn>;
}

function makeCtor(v2: StubV2): typeof TwitterApi {
  const Ctor = vi.fn().mockImplementation(() => ({ v2 }));
  return Ctor as unknown as typeof TwitterApi;
}

describe("createTwitterApiClient", () => {
  it("returns tweet id and url on success", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockResolvedValue({ data: { id: "123", text: "hello" } }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient({ TwitterApiCtor });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({
      ok: true,
      tweetId: "123",
      tweetUrl: "https://x.com/i/status/123",
    });
    expect(v2.tweet).toHaveBeenCalledWith("hello world");
  });

  it("returns ok:false with status and body on 401-shaped error", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockRejectedValue({
        code: 401,
        data: { title: "Unauthorized" },
      }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient({ TwitterApiCtor });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({
      ok: false,
      status: 401,
      body: '{"title":"Unauthorized"}',
    });
  });

  it("returns ok:false on 402 CreditsDepleted-shaped error", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockRejectedValue({
        code: 402,
        data: { detail: "credits depleted" },
      }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient({ TwitterApiCtor });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({
      ok: false,
      status: 402,
      body: '{"detail":"credits depleted"}',
    });
  });

  it("returns status 0 on network throw with no .code", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient({ TwitterApiCtor });

    const result = await client.createPost(INPUT);

    expect(result).toEqual({ ok: false, status: 0, body: "ECONNRESET" });
  });
});
