import type { PublishChannel } from "../../scheduling/job-ids.js";

export type PublishUnavailableReason =
  | "no_archive"
  | "latest_failed"
  | "latest_cancelled"
  | "latest_unreviewed";

const CHANNEL_LABELS: Record<PublishChannel, string> = {
  "email-send": "Email",
  "linkedin-post": "LinkedIn",
  "twitter-post": "Twitter",
};

const REASON_TEXT: Record<PublishUnavailableReason, string> = {
  no_archive: "No completed pipeline archive exists yet.",
  latest_failed: "The latest pipeline run failed.",
  latest_cancelled: "The latest pipeline run was cancelled.",
  latest_unreviewed: "The latest pipeline run is still waiting for review.",
};

export function buildPublishUnavailableMessage(input: {
  readonly channel: PublishChannel;
  readonly reason: PublishUnavailableReason;
  readonly runId?: string;
  readonly publicArchiveBaseUrl?: string;
}): { readonly blocks: readonly unknown[] } {
  const base = input.publicArchiveBaseUrl?.replace(/\/$/, "");
  const reviewUrl =
    input.runId === undefined || base === undefined || base.length === 0
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
          text: `${channel} was not posted. ${REASON_TEXT[input.reason]}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              reviewUrl === null
                ? input.runId === undefined
                  ? "No run is available."
                  : `runId: ${input.runId}`
                : `<${reviewUrl}|Open review> · runId: ${input.runId}`,
          },
        ],
      },
    ],
  };
}
