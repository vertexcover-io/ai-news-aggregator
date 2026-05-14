export interface TwitterCreatePostInput {
  accessToken: string;
  text: string;
  replyToTweetId?: string;
}

export type TwitterCreatePostResult =
  | { ok: true; tweetId: string; tweetUrl: string }
  | { ok: false; status: number; body: string };

export interface TwitterApiClient {
  createPost(input: TwitterCreatePostInput): Promise<TwitterCreatePostResult>;
}
