import type { RunSourceTelemetry } from "../types/run.js";

export interface BuildReviewedMessageArgs {
  runId: string;
  trigger: "manual" | "auto-review";
  archive: {
    id: string;
    digestHeadline: string | null;
    rankedItems: { rawItemId: number }[];
  };
  topRankedTitle: string | null;
  sourceTelemetry: RunSourceTelemetry | null;
  subscriberCount: number;
  publicArchiveBaseUrl?: string;
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

export function buildReviewedMessage(args: BuildReviewedMessageArgs): {
  blocks: unknown[];
} {
  const blocks: SlackBlock[] = [];

  blocks.push(headerBlock(`🟢 Newsletter Reviewed (${args.trigger})`));

  const headline = args.archive.digestHeadline ?? args.topRankedTitle;
  if (headline !== null && headline.length > 0) {
    blocks.push(sectionMarkdown(`*${headline}*`));
  }

  if (args.sourceTelemetry === null) {
    blocks.push(sectionMarkdown("Telemetry unavailable (legacy run)"));
  } else {
    const telemetry = args.sourceTelemetry;
    const lines = ["*📊 Sources*"];
    for (const source of telemetry.sources) {
      lines.push(
        `• ${source.displayName}: ${source.itemsFetched} items${statusSuffix(source.status)}`,
      );
    }
    lines.push(`_Total: ${telemetry.totalItemsFetched} items fetched_`);
    blocks.push(sectionMarkdown(lines.join("\n")));

    const sourcesWithErrors = telemetry.sources.filter(
      (s) => s.errors.length > 0,
    );
    if (sourcesWithErrors.length > 0) {
      const errorLines = [`*⚠️ Errors (${sourcesWithErrors.length})*`];
      for (const source of sourcesWithErrors) {
        errorLines.push(
          `• ${source.displayName}: ${source.errors[0]} (${source.retries} retries) — ${source.status}`,
        );
      }
      blocks.push(sectionMarkdown(errorLines.join("\n")));
    }
  }

  const subscriberWord =
    args.subscriberCount === 1 ? "subscriber" : "subscribers";
  blocks.push(
    sectionMarkdown(
      `*📬 Distribution*\nWill send to ${args.subscriberCount} ${subscriberWord}.`,
    ),
  );

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
