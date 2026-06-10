import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RunCostBreakdown, RunFunnel, RunSourceTelemetry } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import type { SourceType } from "@newsletter/shared/db";
import type { RankResult } from "@pipeline/processors/rank.js";

export function nonEmptyText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

export function pickArchiveDigest(rankResult: RankResult): {
  digestHeadline: string | null;
  digestSummary: string | null;
} {
  if (rankResult.rankedItems.length === 0) {
    return {
      digestHeadline: nonEmptyText(rankResult.digestHeadline),
      digestSummary: nonEmptyText(rankResult.digestSummary),
    };
  }

  const firstRankedItem = rankResult.rankedItems[0];
  return {
    digestHeadline:
      nonEmptyText(firstRankedItem.title) ?? nonEmptyText(rankResult.digestHeadline),
    digestSummary: nonEmptyText(rankResult.digestSummary),
  };
}

export async function writeFailedArchive(input: {
  readonly archiveRepo: RunArchivesRepo;
  readonly runId: string;
  readonly topN: number;
  readonly completedAt: Date;
  readonly startedAt: Date;
  readonly sourceTypes: readonly SourceType[];
  readonly isDryRun: boolean;
  readonly costBreakdown: RunCostBreakdown | null;
  readonly runFunnel: RunFunnel | null;
  readonly sourceTelemetry?: RunSourceTelemetry | null;
  readonly tenantId?: string;
  readonly logger: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  try {
    await input.archiveRepo.upsert({
      id: input.runId,
      status: "failed",
      rankedItems: [],
      topN: input.topN,
      completedAt: input.completedAt,
      startedAt: input.startedAt,
      sourceTypes: [...input.sourceTypes],
      reviewed: false,
      isDryRun: input.isDryRun,
      runFunnel: input.runFunnel,
      sourceTelemetry: input.sourceTelemetry ?? null,
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    });
    if (input.costBreakdown !== null) {
      await input.archiveRepo.setCostBreakdown(input.runId, input.costBreakdown);
    }
    return true;
  } catch (err) {
    input.logger.error(
      {
        event: "archive.write_failed",
        runId: input.runId,
        error: err instanceof Error ? err.message : String(err),
      },
      "archive.write_failed",
    );
    return false;
  }
}
