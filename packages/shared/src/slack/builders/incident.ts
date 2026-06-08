import type { Incident } from "../../types/incident.js";
import { headerBlock, sectionMarkdown } from "./_helpers.js";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  error: "🟠",
  warning: "🟡",
  info: "🔵",
};

/**
 * Build a Slack Block Kit message for an incident alert.
 *
 * Includes: severity + title header, message body, source, occurrence count,
 * and optionally a run link when `runId` is set.
 */
export function buildIncidentMessage(
  incident: Incident,
  publicBaseUrl?: string,
): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  const emoji = SEVERITY_EMOJI[incident.severity] ?? "⚪";
  blocks.push(headerBlock(`${emoji} [${incident.severity}] ${incident.title}`));

  const lines: string[] = [];
  lines.push(`*Message:* ${incident.message}`);

  if (incident.source !== null) {
    lines.push(`*Source:* ${incident.source}`);
  }

  lines.push(`*Occurrences:* ${incident.occurrences}`);
  lines.push(`*Category:* ${incident.category}`);
  lines.push(`*Status:* ${incident.status}`);

  if (incident.runId !== null && publicBaseUrl !== undefined && publicBaseUrl.length > 0) {
    const base = publicBaseUrl.replace(/\/$/, "");
    lines.push(`*Run:* <${base}/archive/${incident.runId}|View archive>`);
  }

  blocks.push(sectionMarkdown(lines.join("\n")));

  return { blocks };
}
