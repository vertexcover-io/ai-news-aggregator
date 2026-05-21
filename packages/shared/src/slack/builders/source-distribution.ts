import type { RunSourceTelemetry } from "../../types/run.js";
import {
  archiveContextLine,
  headerBlock,
  sectionMarkdown,
  statusSuffix,
  truncate,
} from "./_helpers.js";

export function buildSourceDistributionMessage(args: {
  runId: string;
  headline: string | null;
  sourceTelemetry: RunSourceTelemetry;
  publicArchiveBaseUrl?: string;
}): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  blocks.push(headerBlock("📊 Sources collected"));

  if (args.headline !== null && args.headline.length > 0) {
    blocks.push(sectionMarkdown(`*${args.headline}*`));
  }

  const telemetry = args.sourceTelemetry;
  const sourceLines = ["*📊 Sources*"];
  for (const source of telemetry.sources) {
    sourceLines.push(
      `• ${source.displayName}: ${source.itemsFetched} items${statusSuffix(source.status)}`,
    );
  }
  sourceLines.push(`_Total: ${telemetry.totalItemsFetched} items fetched_`);
  blocks.push(sectionMarkdown(sourceLines.join("\n")));

  const sourcesWithErrors = telemetry.sources.filter((s) => s.errors.length > 0);
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

  blocks.push(archiveContextLine(args.runId, args.publicArchiveBaseUrl));

  return { blocks };
}
