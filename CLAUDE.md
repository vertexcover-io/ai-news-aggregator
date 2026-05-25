# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Newsletter Aggregator — a personal AI-powered newsletter engine that scrapes AI news from 34+ sources (HN, Reddit, Twitter/X, RSS, GitHub, company blogs), processes them through a pipeline (dedup, filter, rank, summarize), and delivers a curated daily digest via email after human review. Built for internal use by the Vertexcover team (Ritesh, Aman).

Linear project: [AI Newsletter](https://linear.app/vertexcover/project/ai-newsletter-b8a8925d49ac) (team: Vertexcover, key: VER)

## Architecture

TypeScript monorepo with three independent services and a shared package:

```
packages/
  shared/     @newsletter/shared    — Drizzle DB schema, types, constants, utils
  api/        @newsletter/api       — Hono REST API, auth, job enqueueing, email delivery
  pipeline/   @newsletter/pipeline  — BullMQ workers (collectors, processors), no HTTP
  web/        @newsletter/web       — React + Vite frontend (admin UI + public archive)
```

**Service communication:**
- Frontend -> API via HTTP
- API enqueues jobs to Redis, pipeline workers consume them
- Both API and pipeline share PostgreSQL through the shared Drizzle schema
- Pipeline signals "ready for review" by updating DB status; API sends notification email
- Slack notifications are split across four independent messages, each fired by the worker whose stage produces its data: (1) **`📊 Sources collected`** fires from the `run-process` worker immediately after `run_archives` is written, carrying per-source item counts + collection errors — independent of `autoReview` so the operator sees the source distribution even when manual review is skipped; (2) **`📬 Newsletter emailed`** fires from the `email-send` worker after subscriber delivery, carrying attempted/sent/failed counts and top-3 aggregated failure reasons; (3) **`🟢 LinkedIn posted`** fires from the `linkedin-post` worker on a successful post (suppressed on skip / already-posted / failed / null-permalink); (4) **`🟢 X (Twitter) posted`** is symmetric. Each message is idempotent via a dedicated key in the `run_archives.notification_state` JSONB (`sourceDistribution`, `emailDelivery`, `linkedinPosted`, `twitterPosted`); failures (non-2xx, network error) log `slack.<event>.failed` but never write the key, so a retry can re-post once the platform recovers. Dry-run archives skip all four messages. The pre-existing `notifyReviewPending` (minimal "ready for review" ping when `!autoReview`) is unchanged — operators may receive two messages in quick succession (`sourceDistribution` then `reviewPending`) when manual review is required. The legacy `notifyNewsletterSent` combined-message method and the dead `packages/pipeline/src/workers/newsletter-send.ts` worker are kept for backwards compat (marked `@deprecated`) but not on the active dispatch path.
- The LinkedIn and X (Twitter) auto-posters run as independent BullMQ jobs (`linkedin-post`, `twitter-post`) — each fans out the day's digest headline after the user's scheduled time. The archive link itself is posted as a follow-up **comment** on the LinkedIn share (via `socialActions/{postUrn}/comments`) and as a **reply tweet** on the X thread (never embedded in the main post body) so the head post stays clean and platform algorithms aren't penalised for outbound links. Each notifier is independent: a failure or already-posted skip on one never blocks the other, and a failure to post the link comment/reply never blocks marking the head post as posted (the link failure is logged but does not record a social failure). Idempotency is enforced via `run_archives.linkedin_posted_at` / `run_archives.twitter_posted_at` (timestamps + permalink stored under `social_metadata`; for Twitter the `tweetIds` array under `social_metadata` stores both the head and reply tweet IDs). Both notifiers are skipped when no digest headline is available, when the platform's tokens aren't configured, or when a duplicate-post error from the platform indicates an earlier run already posted.

**Routing (current — public archive listing + admin gate):** The root `/` is a PUBLIC listing of reviewed archives rendered in the Ledger layout: month-grouped, newest first, each row shows a date block (day-of-week eyebrow, serif date, issue number), a serif **digest headline** (≈6–8 words capturing the day's overall theme — preferred from `run_archives.digest_headline`, falling back to `topItems[0].title` for archives created before VER-96), an optional descriptive **dek** (preferred from `run_archives.digest_summary`; on featured rows only it falls back to the rank-1 recap `leadSummary`), and a right-column "N stories / Read →" meta block. The first row whose `leadSummary` is non-null carries `data-featured="true"`. The listing loads 10 rows initially with a client-side "Load more" control, supports client-side month filtering via filter chips, and exposes a search bar plus a date-range chip that drive `?q=`/`?from=`/`?to=` URL params and call the public `GET /api/archives/search` route (Postgres FTS over digest headline + digest summary + top-item titles, accent-insensitive via `unaccent`, with inline term highlighting in the UI). `/sources` is PUBLIC and lists the daily reading list — sections auto-derive from the `SourceType` enum (no manual curation, no LLM call); each row shows Today / This Week / In Digest counts and a status glyph (healthy/idle/failing) computed from `raw_items.collectedAt` and the most-recent `run_archives.sourceTelemetry` entry; row identity is `(sourceType, identifier)` where `identifier` comes from the pure function `deriveRawItemIdentifier` (URL → subreddit / handle / hostname / owner/repo per `SourceType`); the page also renders the live `user_settings.rankingPrompt` verbatim. Data is built by a single `GET /api/sources/summary` call (public). `/archive/:runId` is PUBLIC and renders a single reviewed run in the Ledger aesthetic: `#FAFAF7` background, Newsreader serif headlines, Geist Mono eyebrows, `#8C3A1E` rust accent, and hairline dividers. Each story becomes a section in a 3-column `120px / 1fr / 120px` grid with a numbered N° rail, optional image plate (square-cornered, no shadow), italic serif lede from `recap.summary`, em-dash bullet list (`UNPACKED`), and a rust-rule `BOTTOM LINE` pull-quote block. Nav and Footer are shared via `PublicLayout`. All operator pages are behind a shared-password cookie gate under `/admin/*`: `/admin` (dashboard), `/admin/review/:runId`, `/admin/runs/:runId` (per-run observability page), `/admin/settings`. Unauthenticated visits to `/admin/*` redirect to `/admin/login?next=<path>`. The password lives in `.env` as `ADMIN_PASSWORD`; session HMAC secret is `SESSION_SECRET`. API routing mirrors this: `GET /api/archives` (list) and `GET /api/archives/:runId` are public; `/api/admin/login` and `/api/admin/logout` are public; everything else (`/api/admin/me`, `/api/runs/*`, `/api/settings`, `/api/admin/archives/*` for PATCH/add-post/pool/promote/delete, `/api/admin/runs/:runId/sources` for the per-run raw-items modal on the dashboard, `/api/admin/runs/:runId/observability` for the per-run observability page) is gated by `requireAdmin` middleware reading the `admin_session` cookie.

**Run observability (current):** A per-run observability page at `/admin/runs/:runId` (linked from each dashboard run row's "Details" control) surfaces detailed telemetry: a masthead with a live status pill (`status · stage`), a pipeline funnel (collected → deduped → shortlisted → ranked with drop annotations), per-stage timing + LLM cost strip, a per-source telemetry table, a link-enrichment strip, level=error failure cards (with expandable stack), and a debug timeline with an All/Info/Warn/Error level filter. It is **live** (~2s react-query poll that stops on terminal status) while a run is in progress and **persisted** for any past run. Persistence uses two additions: an append-only **`run_logs`** table (`id bigserial PK`, `run_id uuid` indexed via `(run_id, id)`, `created_at`, `level`/`stage`/`event`/`message text`, `source text NULL`, `context jsonb NULL`) holding milestone events, and a nullable **`run_archives.run_funnel jsonb`** column (`{collected, deduped, shortlisted, ranked}`, each `number | null`). The pipeline emits `run_logs` rows via a best-effort `createRunLogger(runId)` (a failing insert is caught + stdout-logged, never failing the run) and writes `run_funnel` inside the existing finalize upsert. One composition endpoint `GET /api/admin/runs/:runId/observability` returns a single `RunObservability` payload for both modes: **live** (Redis run-state non-terminal, no archive yet) derives the funnel from `stage.result` log rows with `live=true`; **historical** (terminal/expired) sources funnel/sources/enrichment/cost from `run_archives` (+ log fallback for legacy `run_funnel=null`) with `live=false`. `failures` is the `level="error"` subset of `logs`; `logs` are ordered by `run_logs.id` ascending; legacy runs with no logs render empty-state timeline/failures while still showing archived source/cost. Cost is admin-only and never served on a path that bypasses the gate.

**Key data flow (current — two-stage ranking with recap, settings, scheduling, and review):** User settings (schedule, HN/Reddit config, **rerank `rankingPrompt`** — the LLM system prompt for the rerank stage, admin-editable at `/admin/settings`, validated as non-empty and ≤20000 chars, seeded into the singleton row by migration 0026 with the verbatim text of `DEFAULT_RANKING_PROMPT` exported from `@newsletter/shared/constants`; the pipeline re-reads it on every job so admin saves take effect on the next run without a worker restart) are persisted in the `user_settings` DB table (singleton row) and managed via `GET /PUT /api/settings`. The Dashboard (`/admin`) shows recent runs, schedule status, and a "Run Now" button (`POST /api/runs/now`) that triggers an immediate run using saved settings. Daily automatic runs are dispatched by a BullMQ `daily-run` repeatable job, scheduled with `upsertJobScheduler` by `reconcileDailyRunSchedule()` in `services/scheduler.ts` whenever settings change. The pipeline uses a single dispatching `Worker` in `workers/processing.ts` that routes jobs by `job.name` to either `handleDailyRunJob` or `handleRunProcessJob`. Inside a run: collectors run concurrently in-process (via `Promise.allSettled`), writing to `raw_items` (including `imageUrl` per source); Reddit/HN/Twitter/web-search collectors also inline-enrich each item's external URL via the shared `services/link-enrichment` service — one shared `EnrichmentContext` per run wraps `fetchAdaptive` (15 s per-URL timeout, 100 KB markdown cap, cross-collector URL cache, run-level AbortSignal) and writes `metadata.enrichedLink` (title, byline, description, OG image, Readability markdown, status) for each item; self-posts, same-platform links, non-HTML media, and cache hits are classified as `skipped` without a fetch -> dedups -> **stage-1 LLM shortlist** (configurable via admin `shortlistPrompt` + `shortlistSize` on user_settings; uses Claude Haiku 4.5 by default — env override `SHORTLIST_MODEL` — to pick top-N ids from the deduped pool based on title-only signal; cost tracked under `cost_breakdown.stages.shortlist`) -> **stage-2 rerank** feeds the shortlist to Claude Haiku via Vercel AI SDK using a 3-axis prompt (Novelty, Signal-vs-hype, Actionability) to produce the final ordering **plus structured recap content** (`title`, `summary`, `bullets`, `bottomLine`) per item **and a digest-level `{ headline, summary }`** that captures the day's overall theme -> writes `rankedItems` to Redis run-state, recap content to `raw_items.metadata.recap`, and the digest headline/summary to `run_archives.digest_headline` / `digest_summary` (both nullable for backwards compatibility with archives created before VER-96). The per-story `recap.title` is a 4–7 word neutral-newswire headline that **replaces the scraped source title** in all UI surfaces; archives created before this change fall back to the source title via three-tier precedence (`ref.title` > `recap.title` > `row.title`). After a run completes, a "View Archive" button navigates to `/archive/:runId` (recap-style read-only view), and a "Review" button navigates to `/admin/review/:runId` where the user can reorder posts (DnD), remove posts, add a post by URL (`POST /api/admin/archives/:runId/add-post`; the dispatcher in `packages/pipeline/src/services/add-post-helper.ts::detectAddPostSourceType` routes the URL to one of four single-post fetchers — `fetchTwitterPost` for x.com/twitter.com `/status/<id>` URLs, `fetchHnPost` for HN item / Algolia URLs, `fetchRedditPost` for `/r/<sub>/comments/<id>` URLs, and `fetchWebPost` as the generic fallback. Twitter is checked first so Twitter status URLs never fall through to the generic web crawler. Twitter cookies are resolved per-call via `resolveTwitterCollectorCookie` (DB-first / env-fallback) so admin saves at `/admin/settings` take effect on the next call without a restart; CSRF mismatches trigger one in-place refresh + retry, and typed errors (`Twitter cookies not configured — set them at /admin/settings`, `Tweet not found, deleted, or protected: <id>`, `Twitter auth failed — rotate cookies at /admin/settings`) surface as 502s on the API route. Web search is NOT a valid add-post source — the feature is link-based only.), and **inline-edit recap fields** (`title`, `summary`, `bullets`, `bottomLine`, `imageUrl`) directly on each card. Saving the review (`PATCH /api/admin/archives/:runId`) writes the curated order plus any per-item field overrides to the `run_archives` table (`rankedItems` column stores `RankedItemRef` entries that may carry `title`/`summary`/`bullets`/`bottomLine`/`imageUrl` overrides), makes a review-time LLM call over the final reviewed item set to regenerate issue-level `digest_headline` and `digest_summary`, rebuilds `search_text` from that regenerated digest plus reviewed items, and marks the archive as reviewed. If review-time digest generation fails, the save is rejected and the archive is not marked reviewed. Auto-reviewed runs keep the ranking-stage digest because there is no human review mutation. When hydrating items for display (`hydrateRankedItems`), override values stored in `RankedItemRef` take precedence over the original `raw_items.metadata.recap` and `raw_items.imageUrl` values. The manual `/run` page remains for ad-hoc runs with custom config. A running run can be cancelled via `POST /api/runs/:runId/cancel`, which publishes to the Redis pub/sub channel `run:cancel:{runId}`; the pipeline worker subscribes, aborts mid-stage, and sets the run to the `cancelled` terminal status. Per-stage LLM cost (token counts + USD) is tracked across the five LLM call sites (`discoverPostUrls`, `extractPostFields`, `shortlist`, `rerank`, `generateRecap`) via a per-run `CostTracker` and persisted as `run_archives.cost_breakdown` (JSONB, nullable) on success, failure, and cancellation; the admin dashboard exposes a per-row Cost button + dialog. Cost data is admin-only — public archive routes never serialise `costBreakdown`.

**Scheduled publish date (`run_archives.published_at`, migration 0032):** A reviewed archive carries a nullable `published_at timestamptz` that records the *scheduled* publish moment (the next occurrence of the user's `emailTime` after the pipeline completes — distinct from `completedAt`/`startedAt` and from the actual send timestamps `emailSentAt`/`linkedinPostedAt`/`twitterPostedAt`, which are untouched). The pipeline computes it on the **success finalize path** of `handleRunProcessJob` via `resolveScheduledPublishAt({ scheduleTimezone, pipelineTime, emailTime, completedAt })` (exported from `@newsletter/shared/scheduling`); the function returns `null` (never throws) when settings are missing, when `emailTime === pipelineTime`, or on a malformed `HH:MM`, and the worker leaves `published_at = NULL` on failed/cancelled runs. All display surfaces show the **effective publish date** with a `completedAt` fallback: the public listing/search expose it as `runDate` = `coalesce(published_at, completed_at)` (`packages/api/src/services/run-list.ts`), the detail route + `RunState`/`RunSummary` expose it as `issueDate` = `publishedAt ?? startedAt ?? completedAt` (`getIssueDate` in `packages/api/src/routes/archives.ts`), and the public listing + no-query search are **ordered by `coalesce(published_at, completed_at) DESC`** so a publish-dated row outranks an older NULL-published row and month-grouping/issue-numbering follow the same effective date. The raw `published_at` is kept internal — it is never serialised on public archive routes (only the derived `runDate`/`issueDate` is exposed). Archives created before migration 0032 keep `published_at = NULL` and fall back to `completedAt` with no visible regression (no historical backfill).

Required env vars for a full run: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD` (shared password for `/admin/*`), `SESSION_SECRET` (HMAC secret for admin session cookie AND HKDF KEK for the `social_credentials` AES-256-GCM cipher; must be ≥32 bytes); optional `RANKING_MODEL`, `WEB_CRAWLER_CONCURRENCY` (default 4), `SLACK_WEBHOOK_URL` (Slack notification on review-completion; disabled when unset), `PUBLIC_BASE_URL` (used in Slack message archive links), `TAVILY_API_KEY` (web-search collector; disabled when unset — only the pipeline reads this), `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_API_VERSION` (LinkedIn auto-post; disabled when unset), `TWITTER_API_KEY` / `TWITTER_API_SECRET` / `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_TOKEN_SECRET` (X/Twitter OAuth 1.0a auto-post; disabled when unset), `RETTIWT_API_KEY` (X/Twitter **read-only** collector cookies, base64 blob; disabled when unset — the collector silently fails its source unit with an `auth` error and the run continues with the remaining sources). The LinkedIn auto-post, Twitter auto-post, and Twitter collector credential sets above may all be managed at `/admin/settings` — values are stored encrypted at rest in the `social_credentials` table (platforms `linkedin`, `twitter`, `twitter_collector`) and resolved per pipeline job by a DB-first / env-fallback resolver, so saving credentials via the admin UI takes effect on the next pipeline job without a worker restart and shadows any env-var values. The review-pending Slack notice labels any collector that failed with an auth-class error (e.g. `twitter: skipped (missing cookies — set them at /admin/settings)`).

**Future stages (not yet wired):** Daily digest assembly and Resend email delivery — these belong to later PRs and remain documented in the design specs. The review/curation step (PATCH /api/archives/:runId) is now implemented.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React + Vite + Tailwind CSS |
| Frontend routing | react-router-dom |
| Frontend data | @tanstack/react-query (polling/cache) + react-hook-form |
| Backend API | Hono |
| Database | PostgreSQL |
| ORM | Drizzle + Drizzle Kit (migrations) |
| Job Queue | BullMQ + Redis (API uses `Queue.add` with `jobId: runId` to enqueue runs) |
| Ranking LLM | Vercel AI SDK (`ai`) + `@ai-sdk/anthropic` (default `claude-haiku-4-5-20251001`) |
| Validation | zod (API request bodies, ranking structured output) |
| Email | Resend |
| Testing | Vitest 3 (unit + e2e projects per package) |
| Containers | Podman Compose (compose.yml) |
| Linting | ESLint (flat config, per-package) |
| Pre-commit | Husky + lint-staged |

## Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Start all packages in dev mode (via Turborepo)
pnpm build            # Build all packages
pnpm lint             # Lint all packages (ESLint)
pnpm typecheck        # Type check all packages
pnpm infra:up         # Start local PostgreSQL + Redis via podman-compose
pnpm infra:down       # Stop local infrastructure
pnpm infra:reset      # Wipe volumes and restart infrastructure

# Pre-commit hooks (via Husky + lint-staged)
# Automatically runs lint and typecheck on staged files before each commit
# Installed via `pnpm install` (husky prepare script)

# Database
pnpm --filter @newsletter/shared db:generate   # Generate Drizzle migrations from schema changes
pnpm --filter @newsletter/shared db:migrate    # Apply pending Drizzle migrations to PostgreSQL
```

## Design Decisions

- **Scraping approach and AI/LLM choices are deferred** — not yet decided how sources will be scraped or which model handles summarization. Don't assume specific libraries.
- **Pipeline has no HTTP framework** — it's a standalone Node process running BullMQ workers. Don't add Express/Hono/etc to the pipeline package.
- **Shared package owns the DB schema** — all Drizzle schema definitions and migrations live in `@newsletter/shared`. Both API and pipeline import from there.
- **No public subscribers for MVP** — recipients are hardcoded (Ritesh, Aman). No subscription management.
- **Commit design and SPEC only — not orchestration artifacts** — The design doc and SPEC must always be committed to the PR alongside the code they describe. Per-feature design docs live under `docs/plans/<date>-<topic>-design.md` and the SPEC lives under `docs/plans/<feature>/SPEC.md`. **Do NOT commit** orchestrate working artifacts: plan files (`plan.md`), phase files (`phase-*.md`), baseline metrics (`baseline.json`), code review reports (`REVIEW-*.md`), or quality gate reports (`quality-gate.md`). These are per-run scratch files. Under `docs/spec/<feature>/` only commit the authoritative `spec.md` if it lives there; everything else is ephemeral and stays out of git.

## Available Tools & When to Use Them

### MCP Servers

| Tool | When to use |
|------|-------------|
| **PostgreSQL MCP** | Debugging data issues, verifying migrations applied correctly, inspecting schema, checking row counts or data integrity |
| **Redis MCP** | Debugging BullMQ job failures, inspecting queue state (pending/active/failed jobs), checking job payloads, verifying Redis connectivity |
| **GitHub MCP** | Creating/reviewing PRs, managing issues, checking CI status, code review workflows |
| **Playwright MCP** | Testing the React frontend end-to-end, verifying the review dashboard and admin UI render correctly, checking auth flows |
| **Context7** | Fetching current docs for any library in the stack (Hono, Drizzle, BullMQ, Vite, React, Resend) — use this before writing code that touches library APIs |
| **Linear** | Checking issue details, updating ticket status, referencing project context |

### Skills

| Skill | When to use |
|-------|-------------|
| `/debug-jobs` | When pipeline jobs are failing, stuck, or behaving unexpectedly — inspects BullMQ queue state and failed job details |
| `/test-api` | After implementing or modifying API endpoints — hits Hono routes and validates responses match expected types and status codes |
| `/db-migrate` | When schema changes are needed — runs Drizzle Kit migrations with pre/post verification |
| `/monorepo-scaffold` | When setting up a new TypeScript monorepo from a tech stack spec document |
| `/extract-learnings` | After any session where you corrected Claude's code patterns — extracts reusable learnings as rule files in `.claude/rules/learnings/` |

### Custom lint rules

Custom lint rules live in `@newsletter/eslint-plugin` and enforce project-specific patterns (dotenv bootstrap, repository pattern, bundled assets, collector return shape, raw ALTER TABLE, relative imports). They run under `pnpm lint`. See `packages/eslint-plugin/docs/rules/README.md` for the rule index and the decision tree for adding new rules.

### When to reach for what

- **Pipeline not working?** Start with Redis MCP to check queue state, then `/debug-jobs` for details
- **Data looks wrong?** Use PostgreSQL MCP to query directly, check if migrations ran with `/db-migrate`
- **API returning errors?** Use `/test-api` to isolate the endpoint, check logs via Bash
- **Frontend broken?** Use Playwright MCP to test the page, check browser console output
- **Writing code with a library?** Always use Context7 first to get current docs — never assume API signatures

## GitHub Actions — Review Fix Workflow

When triggered by `@claude` on a PR review comment and the request is asking to **fix** code (e.g. "fix this", "can you fix this", "apply this suggestion"), follow this workflow:

1. **Assess clarity** — if the review comment is vague or ambiguous (e.g. "this doesn't look right", "can we improve this?"), reply in the review thread asking for clarification instead of guessing. Only proceed when the fix is clear.
2. **Read the code** — use the file path and line number from the review comment to read the relevant code. Understand what the reviewer is asking to change.
3. **Apply the fix** — make the code changes the reviewer described. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:unit` to verify the fix doesn't break anything.
4. **Commit the fix** — commit the changes with message format `fix: <description> (from review)`. The GitHub Action handles pushing to the right branch automatically (PR branch if open, new branch if merged/closed).
5. **Extract learnings** — invoke the `/extract-learnings` skill in review-fix mode to evaluate whether the reviewer's feedback represents a recurring pattern. If a learning is extracted, include it in a separate commit. If a contradiction with an existing rule is found, mention it in the reply.
6. **Reply to the comment** — in the same review thread, summarize: what was changed, which files were modified, whether tests pass, and any learnings captured or contradictions found.

This workflow ONLY applies when the `@claude` comment is on a PR review comment asking for a code fix. For all other `@claude` interactions (questions, explanations, general tasks), respond normally without this workflow.

## Spec Documents

- `docs/superpowers/specs/2026-04-01-tech-stack-design.md` — Tech stack and monorepo structure decisions
- `docs/superpowers/specs/2026-03-31-ai-newsletter-aggregator-design.md` — Full product design (pipeline, review dashboard, email, admin, archive)
- `docs/superpowers/specs/2026-03-31-user-story.md` — MVP user story and daily flow
- `docs/research/mvp-sources.md` — The 34 sources to collect from

## Ranking eval pipeline

An offline ranking eval system lives under `evals/ranking/` (fixtures, ground-truth, gitignored response cache) and `packages/pipeline/src/eval/` (replay + scoring core, shared with the API). CLI: `pnpm --filter @newsletter/pipeline eval:ranking` (Mode A scored) and `eval:export-fixtures`. Admin UI: `/admin/eval` (Mode A/B with diff-confirm prompt save), `/admin/eval/grade/:fixtureId` (keyboard grading). See `docs/spec/ranking-eval-pipeline/`.

**Calendar mode (Mode B) — pool attribution by `run_id` + dedup-at-eval-time:** Each `raw_items` row carries a nullable `run_id uuid` column (indexed) stamped by the `run-process` worker during the collect stage to point at the run that most-recently collected the item (the upsert updates `run_id` on conflict, so a re-collected item's pointer moves forward to the latest run). The add-post single-item path leaves `run_id = NULL`. When `/admin/eval` Calendar mode builds a run's candidate pool (`createEvalExportsRepo.getCompletedRunDetail` / `listCompletedRunsByDate` in `packages/pipeline/src/repositories/eval-exports.ts`), it loads `raw_items WHERE run_id = $runId` (exact attribution — two runs on the same calendar day are isolated), falling back to the `collectedAt` time window only for pre-migration archives that have no `run_id`-stamped items. The loaded items are then run through the same `dedupCandidates` processor used by the live pipeline (URL-canonical duplicates collapse to the highest-engagement survivor), and the **deduped survivors are the pool the eval re-ranks** — not `run_archives.rankedItems` and not the raw un-deduped set, so the ranker sees the full collected pool and the draft ranking can surface items the original run never ranked. `itemCount` is the deduped pool size and is **identical** between the calendar list row and the loaded run detail (consistency invariant). `previousRanking` rows that fall outside the deduped pool (dedup losers, or items whose `run_id` moved to a later run) still render from the stored `RankedItemRef` fields so the comparison view is never broken. The comparison columns count ranking lengths (`previousRanking.length` / `draftRanking.length`), independent of the pool size. The live collect → dedup → shortlist → rank pipeline output is unchanged — the only live-path change is stamping `run_id`. See `docs/spec/eval-ranker-shortlist-fix/`.

**Run-detail modal — two-tab layout + "items sent for ranking" funnel:** The `/admin/eval/runs` run-detail modal (`packages/web/src/components/eval/RunDetailDrawer.tsx`) presents two full-width tabs — **Prompt & Cost** (prompt snapshot + score-breakdown + cost-breakdown together) and **Report** (full-width two-column rankings, `lg:grid-cols-2`) — for both Mode A (scored) and Mode B (calendar). A done run carrying report data defaults to the Report tab; running / failed / legacy runs default to Prompt & Cost. The Report tab opens with a 3-cell funnel **Sent for ranking → Ranked (top-N) → Cost** (`RankingFunnel` in `CalendarReportComparison.tsx`, reused by `ReportTab.tsx`): the **Sent** cell is the deduped candidate-pool size fed to the LLM ranker (Mode B = `detail.sourcePool.length`, Mode A = fixture pool size), distinct from the ranked-output count, with an italic "(sent − ranked) items considered but not surfaced" note when sent > ranked. The Report tab label carries a compact `N → ranked` hint chip when the pool size is known. The pool size is persisted as an **optional** `poolSize` field inside `eval_runs.scoreBreakdown` JSONB (Mode B `CalendarRunReportEntry` done entry / Mode A `PerFixtureResult`) — no new column, validated by the eval-ranking zod schemas, so legacy runs with no `poolSize` degrade gracefully (the Sent cell and hint chip are omitted, no NaN, the considered-but-not-surfaced note is suppressed). The four scroll regions on the Mode B Report tab (two ranking columns + two prompt panes) and the Mode A ranking column scroll independently with hidden scrollbars (`scrollbar-none` utility in `packages/web/src/index.css`). The same funnel renders in the per-fixture Report dialog on `/admin/eval` (`EvalIndexPage.tsx`). See `docs/spec/eval-report-component/`.
