import type { Queue } from "bullmq";

export const SOCIAL_TEST_POST_QUEUE_NAME = "social-test-post";

export interface SocialTestPostJobData {
  platform: "linkedin" | "twitter";
  requestId: string;
}

export async function enqueueSocialTestPost(
  queue: Pick<Queue<SocialTestPostJobData>, "add">,
  data: SocialTestPostJobData,
): Promise<void> {
  await queue.add(SOCIAL_TEST_POST_QUEUE_NAME, data, {
    jobId: `social-test-${data.requestId}`,
  });
}
