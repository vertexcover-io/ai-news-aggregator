import { describe, expect, it, vi } from "vitest";
import type { TwitterApi } from "twitter-api-v2";

import { createTwitterApiClient } from "../../../../src/social/twitter/api-client.js";

const INPUT = { accessToken: "tok", text: "hello world" };
const CREDENTIALS = {
  appKey: "api-key",
  appSecret: "api-secret",
  accessToken: "access-token",
  accessSecret: "access-secret",
};

interface StubV2 {
  tweet: ReturnType<typeof vi.fn>;
}

function makeCtor(v2: StubV2, extra: Record<string, unknown> = {}): typeof TwitterApi {
  const Ctor = vi.fn().mockImplementation(() => ({ v2, ...extra }));
  return Ctor as unknown as typeof TwitterApi;
}

describe("createTwitterApiClient", () => {
  it("constructs the SDK client with OAuth 1.0a user credentials", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockResolvedValue({ data: { id: "123", text: "hello" } }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    await client.createPost({ text: "hello world" });

    expect(TwitterApiCtor).toHaveBeenCalledWith(CREDENTIALS);
  });

  it("returns tweet id and url on success", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockResolvedValue({ data: { id: "123", text: "hello" } }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.createPost({ text: INPUT.text });

    expect(result).toEqual({
      ok: true,
      tweetId: "123",
      tweetUrl: "https://x.com/i/status/123",
    });
    expect(v2.tweet).toHaveBeenCalledWith("hello world");
  });

  it("posts replies with in_reply_to_tweet_id", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockResolvedValue({ data: { id: "124", text: "reply" } }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.createPost({
      text: "reply",
      replyToTweetId: "123",
    });

    expect(result).toEqual({
      ok: true,
      tweetId: "124",
      tweetUrl: "https://x.com/i/status/124",
    });
    expect(v2.tweet).toHaveBeenCalledWith("reply", {
      reply: { in_reply_to_tweet_id: "123" },
    });
  });

  it("validates credentials with a harmless current-user lookup", async () => {
    const v2: StubV2 = {
      tweet: vi.fn(),
    };
    const currentUserV2 = vi.fn().mockResolvedValue({
      data: { id: "42", username: "vertexcover" },
    });
    const TwitterApiCtor = makeCtor(v2, { currentUserV2 });
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.validateCredentials();

    expect(result).toEqual({ ok: true });
    expect(currentUserV2).toHaveBeenCalledWith(true);
    expect(v2.tweet).not.toHaveBeenCalled();
  });

  it("returns ok:false with status and body on 401-shaped error", async () => {
    const v2: StubV2 = {
      tweet: vi.fn().mockRejectedValue({
        code: 401,
        data: { title: "Unauthorized" },
      }),
    };
    const TwitterApiCtor = makeCtor(v2);
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.createPost({ text: INPUT.text });

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
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.createPost({ text: INPUT.text });

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
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.createPost({ text: INPUT.text });

    expect(result).toEqual({ ok: false, status: 0, body: "ECONNRESET" });
  });

  it("returns ok:false when credential validation fails", async () => {
    const v2: StubV2 = {
      tweet: vi.fn(),
    };
    const currentUserV2 = vi.fn().mockRejectedValue({
      code: 403,
      data: { title: "Forbidden" },
    });
    const TwitterApiCtor = makeCtor(v2, { currentUserV2 });
    const client = createTwitterApiClient(CREDENTIALS, { TwitterApiCtor });

    const result = await client.validateCredentials();

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: '{"title":"Forbidden"}',
    });
  });
});
