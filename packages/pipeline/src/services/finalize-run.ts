import { serializeArchiveSearchText } from "@newsletter/shared";
import type { SlackNotifier, UserSettings, RunFunnel } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import { resolveScheduledPublishAt } from "@newsletter/shared/scheduling";
import type { SourceType } from "@newsletter/shared/db";
import type { RankResult } from "@pipeline/processors/rank.js";
import { buildPreReviewSnapshot } from "@pipeline/services/build-pre-review-snapshot.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import {
  buildSourceTelemetry,
  type CollectorOutcome,
} from "@pipeline/services/source-telemetry.js";
import { toEnrichmentTelemetry } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import type { RunLogger } from "@pipeline/services/run-logger.js";
import { nonEmptyText, pickArchiveDigest } from "@pipeline/services/run-archive-writer.js";

export interface FinalizeRunInput {
  readonly runId: string;
  readonly topN: number;
  readonly sourceTypes: readonly SourceType[];
  readonly dryRun: boolean;
  readonly runStartedAt: Date;
  readonly runLog: RunLogger;
  readonly logger: ReturnType<typeof createLogger>;
  readonly archiveRepo: RunArchivesRepo;
  readonly rawItemsRepo: RawItemsRepo;
  readonly slackNotifier: SlackNotifier | undefined;
  readonly settings: UserSettings | null;
  readonly rankResult: RankResult;
  readonly collectingOutcomes: CollectorOutcome[];
  readonly enrichmentCtx: EnrichmentContext;
  readonly funnel: RunFunnel;
  readonly shortlistIds: number[];
  readonly startedTimestamp: number;
  /** Called after the archive row is successfully written. */
  readonly persistCost: () => Promise<void>;
}

export interface FinalizeRunResult {
  readonly rankedCount: number;
}

export async function finalizeRun(input: FinalizeRunInput): Promise<FinalizeRunResult> {
  const {
    runId, topN, sourceTypes, dryRun, runStartedAt, runLog, logger,
    archiveRepo, rawItemsRepo, slackNotifier,
    settings, rankResult, collectingOutcomes, enrichmentCtx, funnel, shortlistIds,
    startedTimestamp, persistCost,
  } = input;

  const autoReviewed = settings?.autoReview === true;
  const sourceTelemetry = buildSourceTelemetry(collectingOutcomes);
  const enrichmentTelemetry = toEnrichmentTelemetry(enrichmentCtx.counters);
  sourceTelemetry.enrichment = enrichmentTelemetry;
  await runLog.info(
    {
      stage: "processing",
      event: "enrichment.summary",
      enrichment: enrichmentTelemetry,
    },
    "enrichment.summary",
  );

  const { digestHeadline, digestSummary } = pickArchiveDigest(rankResult);
  // LinkedIn header defaults to the constant DEFAULT_LINKEDIN_HOOK at compose
  // time; the rerank LLM still emits a hook string (the schema requires it)
  // but we discard it so the admin sees the constant placeholder in the
  // review UI and posts default to the brand header unless explicitly
  // overridden in the Meta Digest panel.
  const hook = null;
  const twitterSummary = nonEmptyText(rankResult.twitterSummary);
  const rankedRawIds = rankResult.rankedItems.map((r) => r.rawItemId);
  const rankedRawRows = await rawItemsRepo.findByIds(rankedRawIds);
  const rawItemsById = new Map(rankedRawRows.map((r) => [r.id, r]));
  const searchText = serializeArchiveSearchText({
    digestHeadline,
    digestSummary,
    rankedItems: rankResult.rankedItems,
    rawItemsById,
  });
  const completedAt = new Date();
  const publishedAt = resolveScheduledPublishAt({
    scheduleTimezone: settings?.scheduleTimezone,
    pipelineTime: settings?.pipelineTime,
    emailTime: settings?.emailTime,
    completedAt,
  });

  let archiveWritten = false;
  try {
    await archiveRepo.upsert({
      id: runId,
      status: "completed",
      rankedItems: rankResult.rankedItems,
      topN,
      completedAt,
      startedAt: runStartedAt,
      sourceTypes: [...sourceTypes],
      reviewed: autoReviewed,
      digestHeadline,
      digestSummary,
      hook,
      twitterSummary,
      sourceTelemetry,
      searchText,
      isDryRun: dryRun,
      runFunnel: { ...funnel },
      publishedAt: publishedAt ?? undefined,
      shortlistedItemIds: shortlistIds,
      preReviewSnapshot: buildPreReviewSnapshot({
        rankedItems: rankResult.rankedItems,
        digestHeadline,
        digestSummary,
        hook,
        twitterSummary,
      }),
    });
    archiveWritten = true;
  } catch (err) {
    logger.error(
      {
        event: "archive.write_failed",
        runId,
        error: err instanceof Error ? err.message : String(err),
      },
      "archive.write_failed",
    );
  }

  if (archiveWritten) {
    await persistCost();
  }

  if (archiveWritten) {
    try {
      await slackNotifier?.notifySourceDistribution({ runId });
    } catch (err) {
      logger.warn(
        {
          event: "slack.source_distribution.unexpected_throw",
          runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.source_distribution.unexpected_throw",
      );
    }
  }

  if (archiveWritten && settings && !settings.autoReview) {
    await slackNotifier?.notifyReviewPending({ runId });
  }

  logger.info(
    {
      event: "run.completed",
      runId,
      totalDurationMs: Date.now() - startedTimestamp,
      rankedItemCount: rankResult.rankedItems.length,
      dryRun,
    },
    "run.completed",
  );
  await runLog.info(
    {
      stage: "completed",
      event: "run.completed",
      rankedItemCount: rankResult.rankedItems.length,
      durationMs: Date.now() - startedTimestamp,
    },
    "run.completed",
  );

  return { rankedCount: rankResult.rankedItems.length };
}
