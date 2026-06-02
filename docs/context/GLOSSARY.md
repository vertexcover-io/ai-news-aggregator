---
last_verified_sha: 5a2ff20
status: active
---

# Glossary — domain vocabulary

## Core entities

- **raw_item**: A single scraped item from a source (HN post, Reddit thread, tweet, blog post, etc.) stored in the `raw_items` table with engagement metrics, metadata JSONB, and an optional `run_id` pointer.
- **run_archive**: The canonical record of a completed/failed/cancelled pipeline run in the `run_archives` table. Holds ranked items, digest fields, cost breakdown, funnel, notification state, and social metadata.
- **run_state**: Ephemeral Redis key-value (`run:<uuid>`) holding a running pipeline job's live state (status, stage, sources, rankedItems). TTL 3600 seconds.
- **run_log**: Append-only structured log event in the `run_logs` table. Emitted by the pipeline worker during each stage. Used for observability and debugging.

## Pipeline stages

- **collect**: Source-specific fetchers (HN, Reddit, web, Twitter/X, web-search) run concurrently in-process, writing to `raw_items`.
- **dedup**: URL-canonical deduplication. Items with the same normalized URL collapse to the highest-engagement survivor. A covered-link filter first drops items whose URLs were published in prior reviewed runs.
- **shortlist**: Stage-1 LLM (Claude Haiku 4.5) picks top-N items from the deduped pool based on title-only signal. Shortlisted IDs persisted to `run_archives.shortlisted_item_ids`.
- **rerank**: Stage-2 LLM (also Claude Haiku) orders the shortlisted items and produces per-item recap content plus digest-level headline/summary. The system prompt is admin-editable via `/admin/settings`.
- **recap**: The 4-field editorial content per story: `title` (4-7 word neutral headline), `summary` (lede paragraph), `bullets` (em-dash list), `bottomLine` (pull-quote).

## Review & publish

- **pool**: All `raw_items` collected during a run that were NOT selected by the LLM ranker. Accessible in the review UI for promotion into the ranked list.
- **digest_meta**: Top-level synthesized fields: `headline`, `summary`, `hook` (LinkedIn opener), `twitterSummary` (≤180 chars for X).
- **pre_review_snapshot**: Frozen capture of the LLM's original ranking frozen when admin opens the review page. Used by `diffReview` to compute the edit audit trail.
- **notification_state**: JSONB map on `run_archives` tracking which Slack notifications have been sent. Keys: `sourceDistribution`, `emailDelivery`, `linkedinPosted`, `twitterPosted`, `linkedinFailure`, `twitterFailure`, `reviewPending`, `reviewWarning`.
- **immediate_publish**: When admin saves a review after a channel's scheduled moment has passed, that channel's job is enqueued immediately with `delay: 0`.
- **publish_channel**: One of `email-send`, `linkedin-post`, or `twitter-post` — the three delivery channels.

## Infrastructure

- **CredentialCipher**: AES-256-GCM encrypt/decrypt interface. Key derived from `SESSION_SECRET` via HKDF with fixed salt `social-creds-v1`. Used by `social_credentials` and `social_tokens` repos.
- **SendPacer**: Shared module-level token-bucket singleton controlling email send rate (default 3/sec). Used by the email-send worker across all job invocations.
- **EnrichmentContext**: Per-run context wrapping `fetchAdaptive` with URL cache, AbortSignal, and configurable timeouts. Used by collectors for inline link enrichment.
- **CostTracker**: Per-run accumulator for LLM token usage and USD cost. Persisted as `run_archives.cost_breakdown` (JSONB, nullable).

## UI concepts

- **Ledger aesthetic**: Design system for public pages — `#FAFAF7` background, Newsreader serif headlines, Geist Mono eyebrows, `#8C3A1E` rust accent, hairline dividers.
- **source_identifier**: Stable, URL-derived identity string for grouping items by collection source — subreddit name, Twitter handle, GitHub owner/repo, blog hostname. Computed by `deriveRawItemIdentifier`.
- **source_telemetry**: Per-source collection stats (items fetched/stored, duration, retries, errors) persisted per run.
- **run_funnel**: JSONB on `run_archives` with 4 nullable numbers (collected, deduped, shortlisted, ranked) tracking pipeline throughput.
