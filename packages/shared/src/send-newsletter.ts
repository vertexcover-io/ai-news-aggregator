import type { Queue } from "bullmq";
import type { NewsletterSendJobPayload } from "./types/index.js";

export const SEND_NEWSLETTER_QUEUE = "send-newsletter" as const;

export function sendNewsletterJobId(runId: string): string {
  return `send-${runId}`;
}

export async function enqueueSendNewsletter(
  queue: Queue<NewsletterSendJobPayload>,
  runId: string,
): Promise<void> {
  await queue.add(
    SEND_NEWSLETTER_QUEUE,
    { runId, subscriberIds: "all" },
    { jobId: sendNewsletterJobId(runId) },
  );
}
