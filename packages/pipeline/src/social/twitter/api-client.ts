import { TwitterApi } from "twitter-api-v2";

import type {
  TwitterApiClient,
  TwitterCreatePostInput,
  TwitterCreatePostResult,
} from "./types.js";

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
  options: CreateTwitterApiClientOptions = {},
): TwitterApiClient {
  const Ctor = options.TwitterApiCtor ?? TwitterApi;
  return {
    async createPost(
      input: TwitterCreatePostInput,
    ): Promise<TwitterCreatePostResult> {
      try {
        const client = new Ctor(input.accessToken);
        const response = input.replyToTweetId !== undefined
          ? await client.v2.tweet(input.text, {
              reply: { in_reply_to_tweet_id: input.replyToTweetId },
            })
          : await client.v2.tweet(input.text);
        const id = response.data.id;
        return {
          ok: true,
          tweetId: id,
          tweetUrl: `https://x.com/i/status/${id}`,
        };
      } catch (err: unknown) {
        return {
          ok: false,
          status: extractStatus(err),
          body: extractBody(err),
        };
      }
    },
  };
}
