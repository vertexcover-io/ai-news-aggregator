import { serializeArchiveSearchText } from "@newsletter/shared";
import type { SlackNotifier, UserSettings, RunFunnel } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import { resolveScheduledPublishAt } from "@newsletter/shared/scheduling";
import type { SourceType } from "@newsletter/shared/db";
import { evaluateRunHealth } from "@newsletter/shared/analytics";
import type { RunHealthInput } from "@newsletter/shared/analytics";
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
import { notifyReviewReady } from "@pipeline/services/review-ready-notify.js";
import type { NotificationEmailSender } from "@pipeline/services/notification-email.js";
import type { TenantNotificationChannels } from "@pipeline/services/tenant-notify.js";
import { capturePipelineEvent } from "@pipeline/lib/posthog.js";

export interface RunHealthEmitInput extends RunHealthInput {
  readonly runId: string;
}

/**
 * Evaluates run health and emits one `pipeline_run_degraded` PostHog event per finding.
 * Exported for isolated unit testing — does not touch DB or Redis.
 * Swallows all errors (emission must never affect run completion).
 */
export function emitRunHealthEvents(
  input: RunHealthEmitInput,
  capture: (event: string, properties?: Record<string, unknown>) => void,
  logger: Pick<ReturnType<typeof createLogger>, "warn">,
): void {
  const { runId, ...healthInput } = input;
  try {
    const findings = evaluateRunHealth(healthInput);
    for (const f of findings) {
      capture("pipeline_run_degraded", {
        runId,
        kind: f.kind,
        severity: f.severity,
        ...f.detail,
      });
    }
  } catch (err) {
    logger.warn(
      {
        event: "run_health.emit_failed",
        runId,
        error: err instanceof Error ? err.message : String(err),
      },
      "run_health.emit_failed",
    );
  }
}

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
  /**
   * Per-tenant notification channels (P16, REQ-090). Optional with
   * backward-compat defaults: absent = legacy Slack-only behavior, toggles
   * treated as on.
   */
  readonly notificationChannels?: TenantNotificationChannels;
  readonly notificationEmailSender?: NotificationEmailSender;
  readonly publicArchiveBaseUrl?: string;
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
    // Emit run-health degradation events to PostHog. emitRunHealthEvents swallows all
    // errors internally (and capturePipelineEvent no-ops when PostHog is unconfigured),
    // so emission can never affect run completion — no outer try/catch needed here.
    emitRunHealthEvents(
      {
        runId,
        enrichment: { ok: enrichmentTelemetry.ok, failed: enrichmentTelemetry.failed },
        // historicalYield: collectingOutcomes carries no historical-yield signal, so we
        // set false for all sources.  zero_yield_source requires historicalYield=true to
        // fire, so that rule is effectively disabled at this call site (YAGNI — no new DB
        // reads added; can be enabled when historical data is available).
        sources: sourceTelemetry.sources.map((s) => ({
          source: s.identifier,
          collected: s.itemsFetched,
          historicalYield: false,
        })),
        // publish: finalizeRun on main does not publish — publish happens in separate
        // scheduled workers, so partial_publish cannot be evaluated here.
        publish: null,
        isDryRun: dryRun,
      },
      capturePipelineEvent,
      logger,
    );
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
    // P16 (REQ-090): fan out to the TENANT's configured channels — the
    // notifier already carries the tenant-resolved webhook; the email
    // channel stamps its own D-107 marker (reviewPendingEmail).
    await notifyReviewReady({
      runId,
      channels: input.notificationChannels,
      slackNotifier,
      emailSender: input.notificationEmailSender,
      archives: archiveRepo,
      logger,
      publicArchiveBaseUrl: input.publicArchiveBaseUrl,
    });
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
