export interface LinkedInCreatePostInput {
  accessToken: string;
  personUrn: string;
  text: string;
  apiVersion: string;
}

export type LinkedInCreatePostResult =
  | { ok: true; postUrn: string }
  | { ok: false; status: number; body: string; errorCode?: string };

export interface LinkedInCreateCommentInput {
  accessToken: string;
  personUrn: string;
  postUrn: string;
  text: string;
  apiVersion: string;
}

export type LinkedInCreateCommentResult =
  | { ok: true }
  | { ok: false; status: number; body: string };

export interface LinkedInApiClient {
  createPost(input: LinkedInCreatePostInput): Promise<LinkedInCreatePostResult>;
  createComment(
    input: LinkedInCreateCommentInput,
  ): Promise<LinkedInCreateCommentResult>;
}
