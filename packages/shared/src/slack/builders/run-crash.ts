import { headerBlock, sectionMarkdown, truncate } from "./_helpers.js";

/**
 * Run-crash error alert (P16, REQ-091): posted to the TENANT's configured
 * channel when a pipeline run fails terminally (all collectors down or an
 * unhandled stage crash). Markerless by design — like collector-health
 * (D-111), a crash has no successful archive flow to carry a
 * `notification_state` marker, and re-alerting on a retried-and-failed job
 * is preferable to a silent failure.
 */
export function buildRunCrashMessage(args: {
  runId: string;
  error: string;
  stage?: string;
}): { blocks: unknown[] } {
  const blocks: unknown[] = [];
  blocks.push(headerBlock("🔴 Run failed"));
  const where = args.stage !== undefined ? ` (stage: ${args.stage})` : "";
  blocks.push(
    sectionMarkdown(`Run \`${args.runId}\`${where}\n• ${truncate(args.error)}`),
  );
  return { blocks };
}
