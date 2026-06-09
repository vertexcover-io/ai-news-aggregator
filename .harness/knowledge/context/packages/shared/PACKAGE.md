---
governs: packages/shared/src/
last_verified_sha: abbc2469ab05df29b744dde2701d59a7803124e9
sub_packages: [db, types, constants, services, scheduling, slack, review-edits, utils, analytics]
decisions: [D-100, D-101, D-102, D-103, D-104, D-105, D-106, D-107, D-108, D-112, D-113, D-141, D-142]
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

### Analytics (analytics/)
- `resolvePostHogConfig(settings, env?) → PublicPostHogConfig` — pure config resolver; DB-settings-first, env fallback (`POSTHOG_PROJECT_TOKEN`/`POSTHOG_API_KEY`/`POSTHOG_HOST`/`POSTHOG_ENABLED`); `enabled:false` when token absent. Moved here from `packages/api/src/lib/posthog-config.ts` (D-141). Exported as `@newsletter/shared/analytics` subpath.
- `evaluateRunHealth(input: RunHealthInput) → RunHealthFinding[]` — pure run-health degradation evaluator; computes three signal types: enrichment failure rate over threshold, zero-yield sources (historically-yielding sources with 0 collected), partial publish (≥1 ok AND ≥1 failed channel). Returns `[]` for dry runs or null telemetry. No IO.
- `ENRICHMENT_FAILURE_RATE_THRESHOLD = 0.3` — default threshold constant

### Services (services/)
- getCredentialCipher (AES-256-GCM with HKDF from SESSION_SECRET)
- deriveRawItemIdentifier (stable identity from URL per SourceType)
- canonicalizeFetchUrl (SSRF guard), fetchPageStatic (safe HTML fetch)
- classifyItemLifecycle, serializeArchiveSearchText, extractPageMetadata, pickSummarySource

### Slack (slack/)
- createSlackNotifier — factory returning 11 notification methods with idempotency and dry-run gating
- postToWebhook — POST Slack blocks to webhook URL

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
| analytics | src/analytics/ | Pure PostHog config resolver + run-health degradation evaluator (server-safe subpath; no DB/browser imports) |

## Gotchas / landmines
1. **Root barrel leaks DB into browser.** Never import from @newsletter/shared in web code. Use subpath imports. (D-100)
2. **extractUsage provider convention mismatch.** Anthropic reports cache-miss-only inputTokens; Gemini/DeepSeek include cached. Extractors must normalize before billing. (D-101)
3. **Credential cipher uses SESSION_SECRET as KEK.** Rotating SESSION_SECRET invalidates all stored encrypted credentials. (D-104)
4. **deriveRawItemIdentifier JS↔SQL alignment.** Both implementations must produce identical identifiers. Case sensitivity and backslash escaping are classic divergence points. (D-106)
5. **drizzle-kit generate can produce bare ADD COLUMN ... NOT NULL** on tables with rows. Always inspect migrations. (D-105)
6. **Migration journal `when` must be monotonic.** A backdated entry (0035 shipped at 1748433600000) makes already-migrated DBs silently skip the file; fresh DBs are unaffected so CI passes. Heal via an idempotent re-apply migration (0037). (D-113)
7. **jobIdFor uses `-`, not `:`.** bullmq ≥5.x rejects custom job ids containing `:`. (D-112, cross-package — body in root DECISIONS.md)

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
- D-141: resolvePostHogConfig moved to shared/analytics (single source, two consumers). Cross-package — full body in root DECISIONS.md
- D-142: evaluateRunHealth is a pure function in shared/analytics; degradation signals are emitted as PostHog custom events, not thrown exceptions. Cross-package — full body in root DECISIONS.md
