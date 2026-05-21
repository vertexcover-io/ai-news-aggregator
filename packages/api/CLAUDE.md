# @newsletter/api

Hono REST API for job enqueueing and email delivery.

## Responsibilities
- HTTP route handlers and middleware
- Enqueue `run-process` jobs to the Redis `processing` queue via `Queue.add` with `jobId: runId`
- Send digest emails via Resend (future)
- Serve as the backend for the React frontend

## Layout
- `src/routes/` — Hono route modules:
  - `runs.ts` — `POST /api/runs`, `GET /api/runs/:runId`, `POST /api/runs/now` (trigger immediate run from saved settings), `GET /api/runs` (list recent runs)
  - `settings.ts` — `GET /api/settings`, `PUT /api/settings` (read/write `user_settings` singleton row)
  - `archives.ts` — `GET /api/archives` (public list of reviewed archives with top-3 stories + lead summary), `GET /api/archives/:runId` (public single reviewed archive detail; missing, dry-run, and unreviewed archives return 404), `PATCH /api/archives/:runId` (save curated post order, mark reviewed), `POST /api/archives/:runId/add-post` (fetch and add a post by URL), `DELETE /api/admin/archives/:runId` (admin-gated; transactional delete of run_archives + dependent email_sends; best-effort `redis.del("run:<id>")`; returns 204)
  - `archives-search.ts` — `GET /api/archives/search` (public; `q`/`from`/`to`/`limit` params; Postgres FTS over digest headline+summary+top-item titles via the `search_tsv` generated column with `unaccent` + `english` config and `websearch_to_tsquery`; ranks by `ts_rank_cd` when `q` is present, by `completed_at desc` otherwise)
  - `admin-runs.ts` — `GET /api/admin/runs/:runId/sources` (admin-gated; returns the raw_items collected during a run's time window grouped by `sourceType`; resolves the window from `run_archives` first and falls back to the live Redis run-state; 404 with `{ error: "Run not found" }` if neither exists; the `content` field is always omitted from items)
- `src/services/` — business logic invoked by routes:
  - `runs.ts` — seeds Redis run-state and enqueues the single run-process job
  - `rank-hydration.ts` — joins ranked IDs to `raw_items`
  - `scheduler.ts` — `reconcileDailyRunSchedule()` calls BullMQ `upsertJobScheduler` to add/update/remove the daily-run repeatable job whenever settings change
  - `review.ts` — `patchArchive()` and `addPostToArchive()` implement the curation mutations
- `src/repositories/` — Drizzle wrappers including `user-settings.ts` (`get()` and `upsert()` for the singleton settings row)
- `src/lib/` — package-private helpers (`validate.ts` is the zod request-schema layer; `flow.ts` is a legacy `FlowProducer` helper kept in place for rollback and no longer used by `runs.ts`)

## Rules
- No direct scraping or processing logic — that belongs in pipeline
- Communicate with pipeline only through DB and Redis queues / run-state
- Validate all API request input at the boundary with zod
- Use `@newsletter/shared` for types, Redis connection, and the logger factory
- Reuse `createRedisConnection()` from shared rather than instantiating ioredis directly
- DB access goes through `src/repositories/` — routes and services import repository factories, not `@newsletter/shared/db` or `drizzle-orm` directly (enforced by `newsletter/enforce-repository-access`)
- `POST /api/runs` accepts optional `halfLifeHours` field that flows through to the pipeline's ranking.

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest)
pnpm test:e2e     # Run e2e tests (requires DB + Redis via `pnpm infra:up`)
