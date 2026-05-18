import type { PublishChannel } from "../../scheduling/job-ids.js";

const CHANNEL_LABELS: Record<PublishChannel, string> = {
  "email-send": "Email",
  "linkedin-post": "LinkedIn",
  "twitter-post": "Twitter",
};

export function buildPublishFailedMessage(input: {
  readonly runId: string;
  readonly channel: PublishChannel;
  readonly publicArchiveBaseUrl?: string;
}): { readonly blocks: readonly unknown[] } {
  const base = input.publicArchiveBaseUrl?.replace(/\/$/, "");
  const reviewUrl =
    base === undefined || base.length === 0
      ? null
      : `${base}/admin/review/${input.runId}`;
  const channel = CHANNEL_LABELS[input.channel];
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${channel} was not posted`, emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channel} was not posted because the newsletter was not reviewed in time.`,
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
