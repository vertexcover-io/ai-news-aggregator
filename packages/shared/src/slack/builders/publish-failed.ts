import type { PublishChannel } from "../../scheduling/job-ids.js";

const CHANNEL_LABELS: Record<PublishChannel, string> = {
  "email-send": "Email",
  "linkedin-post": "LinkedIn",
  "twitter-post": "Twitter",
};

/**
 * Maps a notifier failure `reason` to operator-facing explanatory text.
 *
 * The `reason` strings come from the social notifiers' `{ status: "failed",
 * reason }` results (see the per-platform notifier.ts under
 * packages/pipeline/src/social) plus the `"not_reviewed"` sentinel that
 * resolvePublishTarget passes for the original not-reviewed-in-time case.
 * Unknown reasons fall back to a generic message so the alert is never wrong —
 * only less specific.
 */
function reasonText(reason: string | undefined): string {
  if (reason === undefined) {
    return "the post could not be completed.";
  }
  switch (reason) {
    case "not_reviewed":
      return "the newsletter was not reviewed in time.";
    case "refresh_unavailable":
      return "the access token expired and no refresh token is available — reconnect on the settings page.";
    case "refresh_failed":
      return "the access token expired and the refresh attempt failed — reconnect on the settings page.";
    case "no_person_urn":
      return "the stored credentials are missing the account identifier — reconnect on the settings page.";
    case "no_token":
      return "no credentials are configured for this platform — connect on the settings page.";
    case "archive_missing":
      return "the run archive could not be found.";
    case "unexpected":
      return "an unexpected error occurred while posting.";
    default:
      if (reason.startsWith("http_")) {
        const code = reason.slice("http_".length);
        return `the platform rejected the request (HTTP ${code}) — the credentials may be invalid or expired.`;
      }
      return `the post failed (${reason}).`;
  }
}

export function buildPublishFailedMessage(input: {
  readonly runId: string;
  readonly channel: PublishChannel;
  readonly reason?: string;
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
          text: `${channel} was not posted because ${reasonText(input.reason)}`,
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
