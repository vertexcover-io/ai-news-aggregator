interface SlackBlock {
  type: string;
  [k: string]: unknown;
}

export function headerBlock(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

export function sectionMarkdown(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

export function contextMarkdown(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

export function statusSuffix(status: "completed" | "failed" | "partial"): string {
  if (status === "failed") return " (failed)";
  if (status === "partial") return " (partial)";
  return "";
}

const ERROR_MESSAGE_MAX_LEN = 120;

export function truncate(s: string, max: number = ERROR_MESSAGE_MAX_LEN): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function renderPermalink(permalink: string): string {
  if (permalink.startsWith("urn:li:share:")) {
    return `<https://www.linkedin.com/feed/update/${permalink}|view>`;
  }
  if (permalink.startsWith("https://x.com/")) {
    return `<${permalink}|view>`;
  }
  return permalink;
}

export function archiveContextLine(
  runId: string,
  publicArchiveBaseUrl: string | undefined,
): SlackBlock {
  if (publicArchiveBaseUrl !== undefined && publicArchiveBaseUrl.length > 0) {
    const base = publicArchiveBaseUrl.replace(/\/$/, "");
    return contextMarkdown(`🔗 <${base}/archive/${runId}|View archive> · runId: ${runId}`);
  }
  return contextMarkdown(`runId: ${runId}`);
}
