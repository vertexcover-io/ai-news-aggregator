import { TwitterApi } from "twitter-api-v2";

import type {
  TwitterApiClient,
  TwitterCreatePostInput,
  TwitterCreatePostResult,
  TwitterCredentialValidationResult,
} from "./types.js";

export interface TwitterOAuth1Credentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export interface CreateTwitterApiClientOptions {
  TwitterApiCtor?: typeof TwitterApi;
}

function extractStatus(err: unknown): number {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return 0;
}

function extractBody(err: unknown): string {
  if (typeof err === "object" && err !== null && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (data !== undefined) {
      try {
        return JSON.stringify(data);
      } catch {
        return "[unserializable response data]";
      }
    }
  }
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "[unknown error]";
}

export function createTwitterApiClient(
  credentials: TwitterOAuth1Credentials,
  options: CreateTwitterApiClientOptions = {},
): TwitterApiClient {
  const Ctor = options.TwitterApiCtor ?? TwitterApi;
  const client = new Ctor(credentials);

  const run = async <T>(
    fn: () => Promise<T>,
  ): Promise<
    | { ok: true; value: T }
    | { ok: false; status: number; body: string }
  > => {
    try {
      return { ok: true, value: await fn() };
    } catch (err: unknown) {
      return {
        ok: false,
        status: extractStatus(err),
        body: extractBody(err),
      };
    }
  };

  return {
    async createPost(
      input: TwitterCreatePostInput,
    ): Promise<TwitterCreatePostResult> {
      const result = await run(() =>
        input.replyToTweetId !== undefined
          ? client.v2.tweet(input.text, {
              reply: { in_reply_to_tweet_id: input.replyToTweetId },
            })
          : client.v2.tweet(input.text),
      );
      if (!result.ok) {
        return {
          ok: false,
          status: result.status,
          body: result.body,
        };
      }
      const id = result.value.data.id;
      return {
        ok: true,
        tweetId: id,
        tweetUrl: `https://x.com/i/status/${id}`,
      };
    },

    async validateCredentials(): Promise<TwitterCredentialValidationResult> {
      const result = await run(() => client.currentUserV2(true));
      if (result.ok) return { ok: true };
      return {
        ok: false,
        status: result.status,
        body: result.body,
      };
    },
  };
}
