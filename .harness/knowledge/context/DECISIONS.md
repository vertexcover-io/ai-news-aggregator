---
last_verified_sha: 226dc6e8b93a852b425cc426ef9dc4a27505bdf4
status: active
---

# Decisions index

| ID | Title | Lives in |
|----|-------|----------|
| D-001 | LinkedIn OAuth callback bypasses admin gate | packages/api/PACKAGE.md |
| D-002 | rettiwt-api allowed only in twitter-handle-resolver | packages/api/PACKAGE.md |
| D-003 | updateRankedItems is a partial UPDATE | packages/api/PACKAGE.md |
| D-004 | Dynamic imports of pipeline at route boundary | packages/api/PACKAGE.md |
| D-005 | raw_items.run_id as preferred attribution column | packages/api/PACKAGE.md |
| D-006 | updateStatus uses WHERE status != $newStatus | packages/api/PACKAGE.md |
| D-007 | DELETE /api/admin/archives/:runId cleans Redis ghosts | packages/api/PACKAGE.md |
| D-008 | SESSION_SECRET is dual-purpose (session HMAC + credential KEK) | packages/api/PACKAGE.md |
| D-009 | PostHog analytics are fire-and-forget with cached config | packages/api/lib/PACKAGE.md |
| D-010 | EMAIL_PROVIDER env switches Resend vs SES at startup | packages/api/lib/email/PACKAGE.md |
| D-011 | SQL DERIVED_IDENTIFIER_SQL mirrors JS deriveRawItemIdentifier | packages/api/repositories/PACKAGE.md |
| D-012 | Credentials encrypted at rest via CredentialCipher | packages/api/repositories/PACKAGE.md |
| D-013 | Digest-meta presence detection uses "k" in input | packages/api/services/PACKAGE.md |
| D-014 | Run cancellation uses Redis pub/sub not BullMQ | packages/api/services/PACKAGE.md |
| D-015 | DebugTimeline dual empty states | packages/web/components/observability/PACKAGE.md |
| D-016 | Source telemetry row disabled for failed/cancelled + zero items | packages/web/components/observability/PACKAGE.md |
| D-017 | Dual publish/start date columns | packages/web/components/dashboard/PACKAGE.md |
| D-018 | SocialOverflowMenu "✓ Posted" without permalink | packages/web/components/dashboard/PACKAGE.md |
| D-027 | Edit newsletter gate includes dry-run; social gate excludes it | packages/web/components/dashboard/PACKAGE.md |
| D-019 | RunDetailDrawer tab default based on report data presence | packages/web/components/eval/PACKAGE.md |
| D-020 | RankingFunnel graceful degradation on null poolSize | packages/web/components/eval/PACKAGE.md |
| D-021 | ArchiveRow is not a link when no stories | packages/web/components/archive-listing/PACKAGE.md |
| D-022 | LinkedIn body seeding from stored value or default | packages/web/pages/PACKAGE.md |
| D-023 | Digest meta regeneration signature tracking | packages/web/pages/PACKAGE.md |
| D-024 | PostHog init dedup by config key | packages/web/lib/PACKAGE.md |
| D-025 | Accept both string and {value:string} rettiwt cursor shapes | packages/pipeline/collectors/twitter/PACKAGE.md |
| D-026 | Guard quoted-tweet access against tombstones | packages/pipeline/collectors/twitter/PACKAGE.md |
| D-030 | Web search provider resolved at worker startup | packages/pipeline/collectors/web-search/PACKAGE.md |
| D-040 | Provider-aware extractUsage dispatches by model prefix | packages/pipeline/processors/PACKAGE.md |
| D-041 | Drop rationale-axis validation from ranker | packages/pipeline/processors/PACKAGE.md |
| D-042 | Shortlist produces no per-item scoring | packages/pipeline/processors/PACKAGE.md |
| D-050 | email_sent_at is the broadcast idempotency marker only | packages/pipeline/workers/PACKAGE.md |
| D-051 | Publish deps are per-job closures not constructor singletons | packages/pipeline/workers/PACKAGE.md |
| D-052 | newsletter-send.ts kept for back-compat only | packages/pipeline/workers/PACKAGE.md |
| D-060 | setCostBreakdown is UPDATE-only | packages/pipeline/repositories/PACKAGE.md |
| D-061 | In-batch dedup in upsertItems | packages/pipeline/repositories/PACKAGE.md |
| D-070 | Best-effort run-logger (telemetry never fails the run) | packages/pipeline/services/PACKAGE.md |
| D-071 | Cost tracker merge is additive not idempotent | packages/pipeline/services/PACKAGE.md |
| D-072 | In-process write serialization for run-state | packages/pipeline/services/PACKAGE.md |
| D-080 | WEB_HTTP_PROXY routes web collector through 3 transport seams (fail-open, secret, undici pinned) | packages/pipeline/services/web-fetch/PACKAGE.md |
| D-090 | Static-first fetch with health check + listing-link check for browser promotion | packages/pipeline/services/web-fetch/PACKAGE.md |
| D-100 | Web must use subpath imports from shared | packages/shared/PACKAGE.md |
| D-101 | Provider-aware token extraction with live-probe verification | packages/shared/PACKAGE.md |
| D-102 | Schema definitions live only in shared | packages/shared/PACKAGE.md |
| D-103 | jsonb columns carry explicit Drizzle $type annotations | packages/shared/PACKAGE.md |
| D-104 | SESSION_SECRET doubles as credential encryption KEK | packages/shared/PACKAGE.md |
| D-105 | Generated migrations must be inspected for NOT NULL adds | packages/shared/PACKAGE.md |
| D-106 | JS and SQL implementations of deriveRawItemIdentifier must stay aligned | packages/shared/PACKAGE.md |
| D-107 | Slack notification idempotency via notification_state JSONB | packages/shared/PACKAGE.md |
| D-108 | publishDateForWindow anchors the publish day on the completion instant | packages/shared/scheduling/PACKAGE.md |
| D-109 | FOR UPDATE row-level lock for LinkedIn token refresh | packages/pipeline/social/linkedin/PACKAGE.md |
| D-110 | Collector health runs on a dedicated queue/worker, never processing concurrency:1 | DECISIONS.md (cross-package) |
| D-111 | Collector-health Slack message has no notification_state marker (fires every failure) | DECISIONS.md (cross-package) |
| D-112 | jobIdFor uses a dash delimiter, not colon | DECISIONS.md (cross-package) |
| D-113 | Migration journal timestamps must be monotonic; heal skipped migrations idempotently | packages/shared/db/PACKAGE.md |
| D-114 | LTF escaping in createPost only | packages/pipeline/social/linkedin/PACKAGE.md |
| D-120 | Social-health worker for proactive credential validation | packages/pipeline/social/twitter/PACKAGE.md |
| D-130 | Calendar mode uses run_id for pool attribution | packages/pipeline/eval/PACKAGE.md |
| D-131 | Dedup at eval-read time, not at fixture-export time | packages/pipeline/eval/PACKAGE.md |
| D-140 | EmailSendError as typed error with retryable + retryAfterMs | packages/pipeline/lib/PACKAGE.md |
| D-115 | publish flag on existing PATCH endpoint (not a separate /draft endpoint) | DECISIONS.md (cross-package) |
| D-116 | draft_saved_at nullable column drives deriveStatus "draft" derived status | DECISIONS.md (cross-package) |

# Cross-package decisions (full bodies)

## D-112 — jobIdFor uses a dash delimiter, not colon

**Why:** bullmq ≥5.x `validateOptions` rejects custom job ids containing `:` (the Redis key delimiter), so `jobIdFor(channel, runId)` emits `${channel}-${runId}` instead of the original `${channel}:${runId}` (fix 2e44ab7). The `*_SCHEDULER_KEY` constants still carry `:` — they are exempt because BullMQ generates their internal job ids itself (`repeat:<key>:<ts>`); only custom ids passed to `Queue.add` are constrained.

**Tradeoff:** Parsing a runId back out of a job id must split on the channel prefix, not a fixed `:`.

**Governs:** packages/shared/src/scheduling/job-ids.ts, the api enqueue sites (routes/archives.ts, routes/runs.ts, services/scheduler.ts), and the pipeline workers that consume those job ids.

## D-110 — Collector health runs on a dedicated queue/worker, never processing concurrency:1

**Why:** A health check must neither block nor be blocked by a pipeline run (F5/NF2). The Blog/crawl check can take ~20–30s and a `run-process` job runs for minutes; the `processing` worker is effectively single-flight per run. So the API enqueues health checks to a dedicated `collector-health` queue (`COLLECTOR_HEALTH_QUEUE_NAME`) consumed by a separate `createCollectorHealthWorker` in the pipeline entrypoint, with its own `createRedisConnection()`, ready/completed/failed listeners, and SIGTERM/SIGINT close. Setting the processing worker to `concurrency: 1` to serialize health checks was explicitly rejected — it would serialize ALL job types (run-process, daily-run, email-send, linkedin-post, twitter-post) and is the recorded anti-pattern in `.claude/rules/learnings/queue-concurrency-vs-in-process-pacer.md`. Within a health job, one strategy throwing never aborts the others (`Promise.allSettled` + per-collector try/catch). The auto-check scheduler is a sibling reconcile (`reconcileCollectorHealthSchedule`) on this same dedicated queue rather than folded into `reconcileDailyRunSchedule` (which only owns the `processing` queue), cron = `toCronMinusMinutes(pipelineTime, COLLECTOR_HEALTH_LEAD_MINUTES=30)`, re-derived on every settings save.

**Tradeoff:** One extra `Queue` (api) + `Worker` (pipeline) + Redis connection to wire and start, plus a second repeatable-scheduler key (`collector-health:default`) to keep in sync with settings. Justified by the hard non-blocking requirement; the alternative (shared queue + raised concurrency) changes scheduling semantics for every job type.

**Governs:** packages/shared/src/constants/index.ts (COLLECTOR_HEALTH_QUEUE_NAME, COLLECTOR_HEALTH_LEAD_MINUTES), packages/api/src/services/scheduler.ts (reconcileCollectorHealthSchedule), packages/api/src/routes/collector-health.ts, packages/pipeline/src/workers/collector-health.ts, packages/pipeline/src/index.ts

## D-111 — Collector-health Slack message has no notification_state marker (fires every failure)

**Why:** A health check has no run and no `run_archives` row, so the D-107 idempotency mechanism (a key in `run_archives.notification_state`) does not apply. By deliberate decision, the consolidated collector-health failure message fires on BOTH manual and scheduled failures every time — there is intentionally no dedup marker. This mirrors the `social-health` notifier shape. One consolidated Block Kit message per job lists every failed collector with its filtered reason (truncated to 120 chars), tagged with the trigger source (`scheduled`/`manual`), built by `buildCollectorHealthMessage` in `shared/slack/builders` and posted via `postToWebhook`. A non-2xx or thrown webhook call logs `slack.collector_health.failed` at warn and never rethrows; a no-op when `SLACK_WEBHOOK_URL` is unset. This is the explicit counterpoint to D-107: D-107 is honored for run-bearing notifications; collector-health deliberately opts out because it has no run to attach a marker to.

**Tradeoff:** An operator re-triggering a still-broken collector will get a repeat Slack alert (no suppression). Accepted — health-check failures are operator-initiated diagnostics, and a repeat alert on a manual re-check is expected, not noise to suppress.

**Governs:** packages/shared/src/slack/builders/collector-health.ts, packages/pipeline/src/workers/collector-health.ts

## D-100 — Web must use subpath imports from shared

**Why:** The root `@newsletter/shared` barrel re-exports `db/index.ts` which transitively pulls `postgres` into the Vite browser bundle, breaking at runtime with `Buffer is not defined`.

**Tradeoff:** Every new shared export needed by web requires adding a subpath entry to `tsup.config.ts` + `package.json#exports`. Acceptable for build safety.

**Governs:** packages/shared/tsup.config.ts, packages/web/src/**

## D-104 — SESSION_SECRET doubles as credential encryption KEK

**Why:** Avoids a separate encryption key env var. The same secret that signs admin cookies also encrypts API credentials at rest. HKDF derivation with a fixed salt makes this cryptographically sound.

**Tradeoff:** Rotating SESSION_SECRET invalidates all stored encrypted credentials — no key rotation mechanism exists. Mitigated by the documented recovery path: re-enter credentials via `/admin/settings`.

**Governs:** packages/shared/src/services/credential-cipher.ts, packages/api/src/auth/session.ts

## D-107 — Slack notification idempotency via notification_state JSONB

**Why:** Each Slack notification writes a dedicated key in `run_archives.notification_state` JSONB after a successful webhook POST. On retry, the existing key suppresses re-send. A failed POST does NOT write the key, so a retry can re-alert once the platform recovers.

**Tradeoff:** A webhook POST success followed by a DB write failure means the next retry sends a duplicate Slack message. Duplicate is preferred over missed — the alternative (write-first, send-second) would permanently suppress alerts on webhook failure.

**Governs:** packages/shared/src/slack/notifier.ts

## D-051 — Publish deps are per-job closures, not constructor singletons

**Why:** The design doc §3 and §4.4 promise that admin credential changes take effect on the next pipeline job without a worker restart. Building publish dependencies (LinkedIn/Twitter notifiers) inside the job processor rather than at worker construction fulfills this contract.

**Tradeoff:** One DB read per job for social credentials (acceptable — once per job, not per item). The credential resolver is DB-first with env-fallback caching within the job.

**Governs:** packages/pipeline/src/workers/processing.ts::buildDefaultPublishDeps

## D-115 — publish flag on the existing PATCH endpoint, not a separate /draft endpoint

**Why:** A separate `/draft` endpoint would duplicate the entire ranked-items validation, review-edits diff, and digest-meta logic with no benefit (`S-global-03`). Adding an optional `publish?: boolean` (default `true`) to `archivePatchSchema` / `PatchArchivePayload` makes the route derive `reviewed = publish` and gate enqueue on `publish`. Fully backward-compatible: existing callers that omit `publish` keep publishing (D-006 pattern: omit → default → unchanged behavior). The F7 guard (reject `publish=false` on an already-reviewed run) lives in `patchArchive` as a server-side safeguard in addition to the UI rule.

**Tradeoff:** Both intents flow through one endpoint; validation must distinguish "persist only" from "persist + publish". Client-side code must set `publish: false` explicitly for draft intent. The alternative (client-side "don't navigate" hack without server changes) was rejected because the server unconditionally set `reviewed=true` and enqueued today.

**Governs:** `packages/shared/src/types/archive.ts` (PatchArchivePayload.publish), `packages/api/src/lib/validate.ts` (archivePatchSchema), `packages/api/src/services/review.ts` (patchArchive draft guard), `packages/api/src/routes/archives.ts` (enqueue gate on publish), `packages/web/src/pages/ReviewPage.tsx` (handleSaveDraft sends publish:false)

## D-116 — draft_saved_at nullable column drives the "draft" derived status

**Why:** A completed run that is `reviewed=false` exists in two distinct states: (a) never touched after completion ("ready to review"), (b) partially edited and saved ("draft"). Both were previously `reviewed=false` with no way to distinguish them. A nullable `run_archives.draft_saved_at` timestamp, stamped on every draft PATCH, is the minimal discriminant. `deriveStatus` checks `reviewed` first (covers published-after-draft — EC2), then `draftSavedAt != null` → "draft", else "ready-to-review". Legacy rows with `draft_saved_at=null` degrade naturally to "ready-to-review" (EC3). The column follows the established additive-nullable-column pattern (like `published_at`, `shortlisted_item_ids`, `run_funnel`).

**Tradeoff:** When `patchArchive` is called with `publish=true` (Save & publish), `draftSavedAt` is passed as `null` to the repo so it is NOT cleared — the existing draft timestamp stays on published rows. `deriveStatus` never reads `draftSavedAt` for a `reviewed=true` run, so the stale value causes no UI inconsistency (EC2 verified). Clearing it on publish would require an extra SET in the UPDATE — not worth the complexity.

**Governs:** `packages/shared/src/db/schema.ts` (runArchives.draftSavedAt), `packages/shared/src/db/migrations/0039_narrow_silver_samurai.sql`, `packages/shared/src/types/settings.ts` (RunSummary.draftSavedAt), `packages/api/src/repositories/run-archives.ts` (UpdateRankedItemsContext.draftSavedAt), `packages/api/src/services/run-list.ts` (serialized to RunSummary), `packages/web/src/components/dashboard/run-status.tsx` (deriveStatus "draft" branch)

## D-014 — Run cancellation uses Redis pub/sub, not BullMQ job control

**Why:** The pipeline worker runs collectors in-process via `Promise.allSettled` and needs to abort mid-stage. BullMQ's job cancellation only works between job invocations, not during execution. The pipeline subscribes to `run:cancel:<runId>` on Redis pub/sub and checks an AbortSignal between collector iterations.

**Tradeoff:** If the pub/sub message is lost (network partition), cancellation silently fails. The operator retries via the API — the cancel endpoint is idempotent.

**Governs:** packages/api/src/services/cancel-run.ts, packages/pipeline/src/workers/run-process.ts
