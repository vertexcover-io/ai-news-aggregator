---
governs: packages/shared/src/types/
last_verified_sha: 5a2ff20
key_files: [index.ts, run.ts, settings.ts, observability.ts, eval-ranking.ts, eval-ranking-schemas.ts, cost-breakdown.ts, archive.ts, health-check.ts]
flow_fns: [index.ts::parseRetryAfter]
decisions: [D-101]
status: active
---

# types/ — shared TypeScript interfaces, zod schemas, and cross-package contracts

## Purpose
Defines every shared interface, type alias, enum, and zod schema consumed by 2+ packages. Types used only within a single package belong in that package.

## Public surface
- Core: RawItemEngagement, RawItemComment, RecapContent, EnrichedLinkContent, RawItemMetadata, CollectorResult, EmailSendError, parseRetryAfter, RETRYABLE_RESEND_CODES
- Run: RankedItem, RankedItemRef, PoolItem, RunState, ItemPreview (TweetPreview | LinkPreview | NoPreview)
- Settings: UserSettings, RunSummary
- Cost: CostStage, CostComponents, ModelStageCost, StageCost, RunCostBreakdown
- Observability: RunLogLevel, RunLogEvent, RunLogEntry, RunFunnel, RunObservability, ItemLifecycle, RunSourceItem
- Eval: Fixture, GroundTruth, EvalResult, CalendarRunDetail, ~30 more types + full zod schema mirrors
- HealthCheck: HealthCheckResult (status/collector/error/durationMs/itemsFound), HealthCheckReport (results/summary counts), HealthCheckJobData (collectorType, triggeredBy), CollectorType union (hn, reddit, twitter, web_search, blog)
- Other: ArchiveListItem, HomePagePayload, SourcesSummaryResponse, Candidate, etc.

## Data flows
parseRetryAfter(headerValue, now?) → number | null:
  headerValue → trim() → regex test for delta-seconds (/^-?\d+$/)
    ├─ match → parseInt → Math.max(0, seconds * 1000)
    └─ no match → Date.parse → valid date? → Math.max(0, parsed - now) : null

## Gotchas / landmines
1. Widening a shared type breaks all constructors across packages. Run pnpm typecheck after any type change.
2. Web must use subpath imports (@newsletter/shared/types) to avoid pulling DB code.
