export interface LinkedInCreatePostInput {
  accessToken: string;
  personUrn: string;
  text: string;
  apiVersion: string;
}

export type LinkedInCreatePostResult =
  | { ok: true; postUrn: string }
  | { ok: false; status: number; body: string; errorCode?: string };

export interface LinkedInApiClient {
  createPost(input: LinkedInCreatePostInput): Promise<LinkedInCreatePostResult>;
}
