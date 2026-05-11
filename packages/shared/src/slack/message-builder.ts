import type { RunSourceTelemetry } from "../types/run.js";
import type {
  DeliveryCounts,
  SocialPostReport,
  SocialResultsForSlack,
} from "./types.js";

export interface BuildReviewedMessageArgs {
  runId: string;
  archive: {
    id: string;
    digestHeadline: string | null;
    rankedItems: { rawItemId: number }[];
  };
  topRankedTitle: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  delivery: DeliveryCounts;
  publicArchiveBaseUrl?: string;
  socialResults?: SocialResultsForSlack;
}

interface SlackBlock {
  type: string;
  [k: string]: unknown;
}

function headerBlock(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

function sectionMarkdown(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

function contextMarkdown(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

function statusSuffix(status: "completed" | "failed" | "partial"): string {
  if (status === "failed") return " (failed)";
  if (status === "partial") return " (partial)";
  return "";
}

const ERROR_MESSAGE_MAX_LEN = 120;

function truncate(s: string, max: number = ERROR_MESSAGE_MAX_LEN): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function buildReviewedMessage(args: BuildReviewedMessageArgs): {
  blocks: unknown[];
} {
  const blocks: SlackBlock[] = [];

  blocks.push(headerBlock("🟢 Newsletter Sent"));

  const headline = args.archive.digestHeadline ?? args.topRankedTitle;
  if (headline !== null && headline.length > 0) {
    blocks.push(sectionMarkdown(`*${headline}*`));
  }

  if (args.sourceTelemetry === null) {
    blocks.push(sectionMarkdown("Telemetry unavailable (legacy run)"));
  } else {
    const telemetry = args.sourceTelemetry;
    const sourceLines = ["*📊 Sources*"];
    for (const source of telemetry.sources) {
      sourceLines.push(
        `• ${source.displayName}: ${source.itemsFetched} items${statusSuffix(source.status)}`,
      );
    }
    sourceLines.push(`_Total: ${telemetry.totalItemsFetched} items fetched_`);
    blocks.push(sectionMarkdown(sourceLines.join("\n")));

    const sourcesWithErrors = telemetry.sources.filter(
      (s) => s.errors.length > 0,
    );
    const errorLines: string[] = [];
    if (sourcesWithErrors.length === 0) {
      errorLines.push("*⚠️ Errors*");
      errorLines.push("• No collection errors");
    } else {
      errorLines.push(`*⚠️ Errors (${sourcesWithErrors.length})*`);
      for (const source of sourcesWithErrors) {
        const reason = truncate(source.errors[0] ?? "unknown");
        errorLines.push(
          `• ${source.displayName}: ${reason} (${source.retries} retries) — ${source.status}`,
        );
      }
    }
    blocks.push(sectionMarkdown(errorLines.join("\n")));
  }

  const { attempted, sent, failed, failureReasons } = args.delivery;
  const recipientWord = sent === 1 ? "subscriber" : "subscribers";
  const distributionLines = ["*📬 Distribution*"];
  if (failed === 0 && attempted === sent) {
    distributionLines.push(`Sent to ${sent} ${recipientWord}.`);
  } else {
    distributionLines.push(
      `Sent to ${sent}/${attempted} ${recipientWord} (${failed} failed).`,
    );
    if (failureReasons !== undefined && failureReasons.length > 0) {
      // Strategic top-3 reasons; aggregated counts beat full per-recipient logs.
      const top = failureReasons.slice(0, 3);
      for (const r of top) {
        distributionLines.push(`  ◦ ${r.count}× ${truncate(r.reason)}`);
      }
      const remaining = failureReasons.length - top.length;
      if (remaining > 0) {
        const otherCount = failureReasons
          .slice(3)
          .reduce((acc, r) => acc + r.count, 0);
        distributionLines.push(`  ◦ ${otherCount}× other (${remaining} more reasons)`);
      }
    }
  }
  blocks.push(sectionMarkdown(distributionLines.join("\n")));

  const socialBlockText = buildSocialPostsBlockText(args.socialResults);
  if (socialBlockText !== null) {
    blocks.push(sectionMarkdown(socialBlockText));
  }

  if (
    args.publicArchiveBaseUrl !== undefined &&
    args.publicArchiveBaseUrl.length > 0
  ) {
    const base = args.publicArchiveBaseUrl.replace(/\/$/, "");
    blocks.push(
      contextMarkdown(
        `🔗 <${base}/archive/${args.runId}|View archive> · runId: ${args.runId}`,
      ),
    );
  } else {
    blocks.push(contextMarkdown(`runId: ${args.runId}`));
  }

  return { blocks };
}

const SOCIAL_STATUS_EMOJI: Record<SocialPostReport["status"], string> = {
  posted: "🟢",
  failed: "🔴",
  skipped: "⚪",
};

function renderPermalink(permalink: string): string {
  if (permalink.startsWith("urn:li:share:")) {
    return `<https://www.linkedin.com/feed/update/${permalink}|view>`;
  }
  if (permalink.startsWith("https://x.com/")) {
    return `<${permalink}|view>`;
  }
  return permalink;
}

function renderSocialLine(
  platformLabel: string,
  report: SocialPostReport,
): string {
  const emoji = SOCIAL_STATUS_EMOJI[report.status];
  const head = `${emoji} ${platformLabel}: ${report.status}`;

  if (report.status === "posted") {
    if (report.permalink === null || report.permalink === undefined) {
      return `${head} (duplicate detected)`;
    }
    return `${head} — ${renderPermalink(report.permalink)}`;
  }

  if (report.reason !== undefined && report.reason.length > 0) {
    return `${head} — ${report.reason}`;
  }
  return head;
}

function buildSocialPostsBlockText(
  socialResults: SocialResultsForSlack | undefined,
): string | null {
  if (socialResults === undefined) return null;
  const lines: string[] = [];
  if (socialResults.linkedin !== undefined) {
    lines.push(renderSocialLine("LinkedIn", socialResults.linkedin));
  }
  if (socialResults.twitter !== undefined) {
    lines.push(renderSocialLine("X", socialResults.twitter));
  }
  if (lines.length === 0) return null;
  return ["*🔗 Social posts*", ...lines].join("\n");
}
