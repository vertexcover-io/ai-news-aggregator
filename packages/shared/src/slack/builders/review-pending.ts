import type { RunSourceTelemetry, SourceTelemetryEntry } from "../../types/index.js";

const AUTH_HINT_KEYWORDS = [
  "auth",
  "unauthorized",
  "unauthenticated",
  "401",
  "403",
  "forbidden",
  "missing cookies",
  "invalid cookies",
  "missing or invalid cookies",
] as const;

function isAuthFailure(entry: SourceTelemetryEntry): boolean {
  if (entry.status !== "failed") return false;
  const blob = entry.errors.join(" \n").toLowerCase();
  return AUTH_HINT_KEYWORDS.some((kw) => blob.includes(kw));
}

// Spec: .harness/features/twitter-cookies-admin-settings/spec.md REQ-008.
// Label collector auth failures clearly so an operator opening Slack sees
// "twitter: skipped (missing cookies — set them at /admin/settings)" rather
// than a stack trace fragment. Generalises across collectors: any source whose
// failure looks like an auth-class failure gets the labelled treatment.
function buildSourceFailureLine(entry: SourceTelemetryEntry): string {
  const summary = entry.errors[0] ?? "auth failed";
  const truncated = summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
  if (entry.sourceType === "twitter") {
    const isCookieIssue = truncated.toLowerCase().includes("cookie");
    return `• twitter: skipped (${isCookieIssue ? "missing cookies — set them at /admin/settings" : truncated})`;
  }
  return `• ${entry.sourceType}: skipped (${truncated})`;
}

export function buildReviewPendingMessage(input: {
  readonly runId: string;
  readonly digestHeadline: string | null;
  readonly publicArchiveBaseUrl?: string;
  readonly sourceTelemetry?: RunSourceTelemetry | null;
}): { readonly blocks: readonly unknown[] } {
  const base = input.publicArchiveBaseUrl?.replace(/\/$/, "");
  const reviewUrl =
    base === undefined || base.length === 0
      ? null
      : `${base}/admin/review/${input.runId}`;

  const authFailureLines = (input.sourceTelemetry?.sources ?? [])
    .filter(isAuthFailure)
    .map(buildSourceFailureLine);

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Newsletter ready for review", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: input.digestHeadline
          ? `*${input.digestHeadline}*`
          : "A new newsletter run is ready.",
      },
    },
  ];

  if (authFailureLines.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Collector auth failures*\n${authFailureLines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text:
          reviewUrl === null
            ? `runId: ${input.runId}`
            : `<${reviewUrl}|Open review> · runId: ${input.runId}`,
      },
    ],
  });

  return { blocks };
}
