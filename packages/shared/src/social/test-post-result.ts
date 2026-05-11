export const SOCIAL_TEST_TTL_SECONDS = 300;

export function socialTestKey(requestId: string): string {
  return `social-test:${requestId}`;
}

export interface SocialTestResult {
  status: "posted" | "failed";
  permalink?: string | null;
  error?: string;
}
