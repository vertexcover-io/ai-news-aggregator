---
governs: packages/shared/src/
last_verified_sha: 8f2bc3411177651bbd5e223a7aba4b77be130474
sub_packages: [db, types, constants, services, scheduling, slack, review-edits, utils, alerting]
decisions: [D-100, D-101, D-102, D-103, D-104, D-105, D-106, D-107, D-108, D-112, D-113, D-115, D-116, D-118]
status: active
---

# shared — monorepo foundation: DB schema, types, constants, utilities, and cross-cutting services

## Purpose
The `@newsletter/shared` package is the single source of truth for the monorepo's data layer and shared contracts. It owns all Drizzle ORM schema definitions, database migrations, shared TypeScript types, LLM prompt constants, utility functions, and cross-cutting services (credential encryption, Slack notifications, scheduling math, URL safety). Every other package depends on it.

## Public surface

### Database (db/)
- `getDb() → AppDb` — singleton Postgres client
- `createRedisConnection(opts?) → IORedis` — factory for Redis client (maxRetriesPerRequest: null for BullMQ compat)
- Drizzle schema exports: rawItems, runArchives, runLogs, userSettings, socialTokens, socialCredentials, subscribers, emailSends, sesEvents, evalRuns, reviewEdits, mustReadEntries

### Types (types/)
- All shared TypeScript interfaces used by 2+ packages: RawItemEngagement, RawItemMetadata, RecapContent, EnrichedLinkContent, RankedItem, RankedItemRef, RunState, PoolItem, UserSettings, RunSummary, RunCostBreakdown, RunObservability, and ~100 more
- EmailSendError class with retryAfterMs and retryable fields
- parseRetryAfter(headerValue, now?) → number | null — parses Retry-After header to ms

### Constants (constants/)
- DEFAULT_RANKING_PROMPT — the full LLM system prompt for the rerank stage
- DEFAULT_SHORTLIST_PROMPT — the LLM system prompt for the stage-1 shortlist
- DIGEST_META_INSTRUCTIONS + digestSchema — standalone digest-field guidance
- buildLinkedinPostBody(hook, stories) → string — LinkedIn post body assembler
- SOURCE_TYPE_SECTION_LABELS, SOURCE_TYPE_ORDER, eval constants

### Pricing & Cost (src/cost.ts, src/pricing.ts)
- MODEL_PRICING, computeCallCost, extractUsage (provider-aware token normalization), parseRunCostBreakdown

### Scheduling (scheduling/)
- resolveScheduledPublishAt, selectImmediatePublishChannels, dateAtTzTime, publishDateForWindow (completion-anchored, D-108), jobIdFor (`{channel}-{runId}` dash delimiter — bullmq rejects `:`, D-112)

### Services (services/)
- getCredentialCipher (AES-256-GCM with HKDF from SESSION_SECRET)
- deriveRawItemIdentifier (stable identity from URL per SourceType)
- canonicalizeFetchUrl (SSRF guard), fetchPageStatic (safe HTML fetch)
- classifyItemLifecycle, serializeArchiveSearchText, extractPageMetadata, pickSummarySource

### Slack (slack/)
- createSlackNotifier — factory returning 11 notification methods with idempotency and dry-run gating
- postToWebhook — POST Slack blocks to webhook URL

### Alerting (alerting/)
- `createAlertDispatcher(deps)` → `AlertDispatcher` — durable-first incident capture facade; never throws (D-116/NF1)
- `fingerprintFor(category, source, signature)` → `string` — produces `category:domain:signature` dedup key (D-115)
- `evaluateRunHealth(runId, outcomes, deps)` → captures incidents for failed/degraded runs; called from `finalizeRun`
- `AlertChannel` interface — `{ enabled: boolean, send(incident): Promise<boolean> }`
- `SlackAlertChannel` — concrete impl wrapping `postToWebhook`; constructed from `SLACK_WEBHOOK_URL` env
- Re-exports `IncidentSeverity`, `IncidentCategory`, `IncidentStatus`, `IncidentRepository`, `Incident` from types

### Review edits (review-edits/)
- diffReview(snapshot, patch) → ReviewEditRow[] — computes add/remove/reorder/text_edit rows

## Depends on / used by
Uses: drizzle-orm, postgres, ioredis, pino, zod, node:crypto
Used by: @newsletter/api, @newsletter/pipeline, @newsletter/web (subpath imports only)

## Data flows (spine)
- startRun() → writes Redis run-state → enqueues BullMQ run-process job
- extractUsage() / computeCallCost() → normalize & price LLM tokens per provider
- resolveScheduledPublishAt() / selectImmediatePublishChannels() → drive publish timing
- createSlackNotifier() → posts 5 idempotent Slack messages per run
- diffReview() → captures before/after edit deltas on admin review save
- serializeArchiveSearchText() → builds FTS document for public archive search
- getCredentialCipher() → encrypts/decrypts social credentials at rest

## Sub-packages
| Sub-package | Path | Intent |
|-------------|------|--------|
| db | src/db/ | Drizzle ORM schema, DB client, Redis connection |
| types | src/types/ | Shared TypeScript interfaces and zod schemas |
| constants | src/constants/ | LLM prompts, source labels, eval constants |
| services | src/services/ | Pure utility services (crypto, URL safety, lifecycle, search, metadata) |
| scheduling | src/scheduling/ | Timezone math, publish date resolution, job IDs |
| slack | src/slack/ | Slack notification system (notifier, builders, webhook) |
| review-edits | src/review-edits/ | Review diff computation |
| utils | src/utils/ | Prompt hashing, reading time, timezone formatting |
| alerting | src/alerting/ | Incident capture dispatcher, fingerprinting, run-health evaluator, alert channels |

## Gotchas / landmines
1. **Root barrel leaks DB into browser.** Never import from @newsletter/shared in web code. Use subpath imports. (D-100)
2. **extractUsage provider convention mismatch.** Anthropic reports cache-miss-only inputTokens; Gemini/DeepSeek include cached. Extractors must normalize before billing. (D-101)
3. **Credential cipher uses SESSION_SECRET as KEK.** Rotating SESSION_SECRET invalidates all stored encrypted credentials. (D-104)
4. **deriveRawItemIdentifier JS↔SQL alignment.** Both implementations must produce identical identifiers. Case sensitivity and backslash escaping are classic divergence points. (D-106)
5. **drizzle-kit generate can produce bare ADD COLUMN ... NOT NULL** on tables with rows. Always inspect migrations. (D-105)
6. **Migration journal `when` must be monotonic.** A backdated entry (0035 shipped at 1748433600000) makes already-migrated DBs silently skip the file; fresh DBs are unaffected so CI passes. Heal via an idempotent re-apply migration (0037). (D-113)
7. **jobIdFor uses `-`, not `:`.** bullmq ≥5.x rejects custom job ids containing `:`. (D-112, cross-package — body in root DECISIONS.md)
8. **Alert dispatcher is best-effort / never-throws.** `createAlertDispatcher().capture(input)` wraps every step in try/catch; on any error it logs fatal and returns — it NEVER throws into the caller. (D-116/NF1)
9. **shared/alerting has zero drizzle-orm imports.** The `IncidentRepository` interface is defined in types; concrete implementations live in api and pipeline repos. Importing drizzle-orm into alerting/ would break the Vite browser bundle (same root-barrel issue as D-100). (D-116)

## Decisions
- D-100: Web must use subpath imports from shared. Governs: packages/shared/tsup.config.ts
- D-101: Provider-aware token extraction with live-probe verification. Governs: packages/shared/src/cost.ts
- D-102: Schema definitions live only in shared. Governs: packages/shared/src/db/
- D-103: jsonb columns carry explicit Drizzle $type annotations. Governs: packages/shared/src/db/schema.ts
- D-104: SESSION_SECRET doubles as credential encryption KEK. Governs: packages/shared/src/services/credential-cipher.ts
- D-105: Generated migrations must be inspected for NOT NULL adds on populated tables. Governs: packages/shared/src/db/
- D-106: JS and SQL implementations of deriveRawItemIdentifier must stay aligned. Governs: packages/shared/src/services/source-identifier.ts
- D-107: Slack notification idempotency via notification_state JSONB. Governs: packages/shared/src/slack/notifier.ts
- D-108: publishDateForWindow anchors the publish day on the run-completion instant (rollover-safe). Governs: packages/shared/src/scheduling/tz.ts — full body in scheduling/PACKAGE.md
- D-112: jobIdFor uses `-` delimiter (bullmq rejects `:` in custom job ids). Cross-package — full body in root DECISIONS.md
- D-113: Migration journal timestamps must be monotonic; heal skipped migrations idempotently. Governs: packages/shared/src/db/migrations — full body in db/PACKAGE.md
- D-115: Incident fingerprint = category:domain:signature. Parallel to D-107 but at incident level, not run level. Full body in root DECISIONS.md
- D-116: shared/alerting never imports drizzle-orm; IncidentRepository is interface-only. Full body in root DECISIONS.md
- D-118: shouldNotify computed from pre-update notified_at; notified_at advanced only on successful send. Full body in root DECISIONS.md
