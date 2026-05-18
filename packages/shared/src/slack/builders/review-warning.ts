import type { PublishChannel } from "../../scheduling/job-ids.js";

const CHANNEL_LABELS: Record<PublishChannel, string> = {
  "email-send": "Email",
  "linkedin-post": "LinkedIn",
  "twitter-post": "Twitter",
};

export function buildReviewWarningMessage(input: {
  readonly runId: string;
  readonly earliestChannel: PublishChannel;
  readonly earliestTime: string;
  readonly minutesUntil: number;
  readonly publicArchiveBaseUrl?: string;
}): { readonly blocks: readonly unknown[] } {
  const base = input.publicArchiveBaseUrl?.replace(/\/$/, "");
  const reviewUrl =
    base === undefined || base.length === 0
      ? null
      : `${base}/admin/review/${input.runId}`;
  const channel = CHANNEL_LABELS[input.earliestChannel];
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Review deadline approaching", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channel} is scheduled for ${input.earliestTime}. Review is due in about ${input.minutesUntil} minutes.`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: reviewUrl === null
              ? `runId: ${input.runId}`
              : `<${reviewUrl}|Open review> · runId: ${input.runId}`,
          },
        ],
      },
    ],
  };
}
