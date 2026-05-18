export function buildReviewPendingMessage(input: {
  readonly runId: string;
  readonly digestHeadline: string | null;
  readonly publicArchiveBaseUrl?: string;
}): { readonly blocks: readonly unknown[] } {
  const base = input.publicArchiveBaseUrl?.replace(/\/$/, "");
  const reviewUrl =
    base === undefined || base.length === 0
      ? null
      : `${base}/admin/review/${input.runId}`;
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Newsletter ready for review", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: input.digestHeadline ? `*${input.digestHeadline}*` : "A new newsletter run is ready.",
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
