---
governs: packages/pipeline/src/
last_verified_sha: 5a2ff20
sub_packages: [collectors, collectors/twitter, collectors/web-search, processors, workers, repositories, services, services/link-enrichment, services/web-fetch, social, social/linkedin, social/twitter, eval, lib]
decisions: [D-001, D-002, D-003, D-004]
status: active
---

# pipeline — BullMQ worker process for AI newsletter collection, processing, ranking, and publishing

## Purpose
A standalone Node process that runs BullMQ workers to collect from 34+ AI news sources, deduplicate, shortlist, rank via Claude LLM, store recap content, and deliver the curated digest via email + social auto-posts. No HTTP framework.

## Public surface
- `src/index.ts` — process entrypoint; boots collection + processing workers, validates env, handles SIGTERM/SIGINT shutdown
- `src/add-post-entry.ts` — cross-package barrel for API to import add-post helpers without booting workers
- `src/eval-entry.ts` — cross-package barrel for API to import eval pipeline primitives without booting workers
- `getRunIdFromJobData(data)` → `string | undefined` — extracts runId from raw BullMQ job data

## Depends on / used by
- Uses: `@newsletter/shared` (DB schema, types, constants, services), `bullmq`, `ai`/`@ai-sdk/anthropic`/`@ai-sdk/deepseek`, `crawlee`, `rettiwt-api`, `resend`, `@tavily/core`, `twitter-api-v2`, `drizzle-orm`
- Used by: `@newsletter/api` (via add-post-entry + eval-entry barrels)

## Data flows (spine)
- **Daily scheduled run**: `handleDailyRunJob` loads settings → `startRun()` → enqueues `run-process` job into processing queue
- **Run process**: `handleRunProcessJob` → [collectors] concurrent in-process → [dedup] covered-link filter + URL-canonical → [shortlist] Claude Haiku top-N by title → [rank] Claude Sonnet rerank + recap generation → [finalize] write archive + Slack notify
- **Email send**: `handleEmailSendJob` → resolve target archive → render newsletter HTML via React → paced send to subscribers → mark `email_sent_at` + Slack notify
- **Social post**: `handleLinkedInPostJob` / `handleTwitterPostJob` → resolve target → compose message → post head + archive link comment/reply → mark posted + Slack notify
- **Cancel**: `POST /api/runs/:runId/cancel` publishes to Redis `run:cancel:{runId}` → worker's `CancelSubscriber` aborts the run mid-stage → writes `cancelled` archive

## Sub-packages
| Package | Path | Role |
|---------|------|------|
| collectors | `src/collectors/` | Fetch from HN, Reddit, web blogs, Twitter/X, web search |
| collectors/twitter | `src/collectors/twitter/` | Rettiwt client adapter, tweet mapping, CSRF refresh |
| collectors/web-search | `src/collectors/web-search/` | Pluggable web search provider interface + Tavily impl |
| processors | `src/processors/` | Dedup, shortlist, rank, recap, digest-meta (pure stage fns) |
| workers | `src/workers/` | BullMQ job handlers (run-process, email-send, linkedin/twitter-post, etc.) |
| repositories | `src/repositories/` | Drizzle DB wrappers (raw_items, run_archives, run_logs, etc.) |
| services | `src/services/` | Cross-cutting state (Redis run-state, cost tracking, cancel, telemetry, enrichment, web fetch, add-post) |
| services/link-enrichment | `src/services/link-enrichment/` | Inline URL enrichment for collector items |
| services/web-fetch | `src/services/web-fetch/` | HTML→markdown conversion (Readability+Turndown) with static→browser fallback |
| social | `src/social/` | Platform-agnostic message composition + OAuth helpers |
| social/linkedin | `src/social/linkedin/` | LinkedIn Posts API, token refresh, notifier |
| social/twitter | `src/social/twitter/` | Twitter OAuth 1.0a API, notifier |
| eval | `src/eval/` | Offline ranking eval pipeline (fixture export, replay, scoring) |
| lib | `src/lib/` | Low-level utilities (boot check, fetch wrappers, pacer, email provider) |

### Thin files (no sub-package)
- `queues/` (2 files): `collection.ts`, `processing.ts` — BullMQ `Queue` constructor singletons, thin
- `services/add-post/` (1 file): `dispatch.ts` — routes add-post URL to single-post fetcher
- `scripts/` (5 files): CLI entrypoints, not part of the worker process
- `types.ts` (root): Collector config interfaces, thin types
- `types/turndown-plugin-gfm.d.ts`: Ambient declaration for turndown-plugin-gfm

## Gotchas / landmines
- **Worker is multi-type dispatcher**: The `processing` Worker routes by `job.name` (run-process, daily-run, email-send, linkedin-post, twitter-post, social-health). `concurrency: 1` would serialize all types — instead use the `SendPacer` for email rate-limiting. (D-001)
- **Credential freshness**: `linkedinPostDeps`/`twitterPostDeps` are built per-job via `buildPublishDeps()`, not at worker startup. This fulfills the "admin save takes effect on next job without restart" contract. (D-002)
- **`setCostBreakdown` is partial UPDATE**: Requires the archive row to exist first — failure paths in `run-process.ts` insert a partial archive before persisting cost. (D-003)
- **`email_sent_at` is broadcast-only**: Targeted welcome sends must NOT stamp this marker or they poison the daily broadcast guard. (D-004)
- **Twitter client per-job**: `twitterClient` is a `() => Promise<TwitterClient>` factory invoked per job so admin cookie saves take effect without restart.

## Decisions
- **D-001**: Shared `SendPacer` singleton for email rate-limiting instead of BullMQ `concurrency: 1`. Why: the processing worker handles 6+ job types; serializing them all behind one long run-process job would delay email delivery and social posts. Tradeoff: the pacer's promise-chain serializes within the process; if multiple worker processes run, each has its own pacer (acceptable — Resend rate limit is keyed by account, not process). Governs: `workers/email-send.ts`, `lib/email-provider.ts`.
- **D-002**: Social/email publish deps are built per-job (not at worker startup). Why: the design doc promises credential changes take effect on next job without restart. Tradeoff: each job incurs a DB read for credentials (acceptable — once per job, not per item). Governs: `workers/processing.ts::buildDefaultPublishDeps`.
- **D-003**: `setCostBreakdown` is a bare `UPDATE` with no row-existence guard. Why: the archive row is created earlier on all paths now. Tradeoff: if a new caller omits the upsert-before-update pattern, cost data is silently lost. Governs: `repositories/run-archives.ts::setCostBreakdown`.
- **D-004**: `email_sent_at`, `linkedin_posted_at`, `twitter_posted_at` are broadcast idempotency markers only. Why: per-recipient sends (welcome, back-issue) must not stamp the broadcast guard. Tradeoff: per-recipient dedup belongs on `email_sends` table. Governs: `workers/email-send.ts`, `workers/linkedin-post.ts`, `workers/twitter-post.ts`.
