import type { HealthCheckReport } from "../../types/health-check.js";
import { headerBlock, sectionMarkdown } from "./_helpers.js";

export function buildHealthCheckFailedBlocks(report: HealthCheckReport): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  blocks.push(headerBlock("🩺 Collector Health Check Failed"));

  if (report.failedCount === 0) {
    blocks.push(sectionMarkdown("All collectors healthy ✓"));
  } else {
    const failureLines: string[] = [];
    for (const result of report.results) {
      if (result.status === "failed" && result.error !== undefined) {
        failureLines.push(`• *${result.collector}*: ${result.error}`);
      }
    }
    blocks.push(sectionMarkdown(`*Failed collectors*\n${failureLines.join("\n")}`));
  }

  const summaryParts: string[] = [
    `${report.healthyCount} healthy`,
    `${report.failedCount} failed`,
    `${report.skippedCount} skipped`,
  ];
  const summaryText = summaryParts.join(" · ");
  blocks.push(sectionMarkdown(`*Summary*: ${summaryText}  (${report.totalDurationMs}ms)`));

  return { blocks };
}
