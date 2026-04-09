# @newsletter/api

Hono REST API for job enqueueing and email delivery.

## Responsibilities
- HTTP route handlers and middleware
- Enqueue `run-process` jobs to the Redis `processing` queue via `Queue.add` with `jobId: runId`
- Send digest emails via Resend (future)
- Serve as the backend for the React frontend

## Layout
- `src/routes/` — Hono route modules (`runs.ts` for `POST /api/runs` and `GET /api/runs/:runId`; `profiles.ts` for `GET /api/profiles`, which lists available user profiles for the Run form)
- `src/services/` — business logic invoked by routes (`runs.ts` seeds Redis run-state and enqueues the single run-process job; `rank-hydration.ts` joins ranked IDs to `raw_items`; `profiles.ts` loads and parses `profiles/*.yaml` from `PROFILES_DIR` if set, else from `<repo-root>/profiles` resolved relative to the source file)
- `src/lib/` — package-private helpers (`validate.ts` is the zod request-schema layer; `flow.ts` is a legacy `FlowProducer` helper kept in place for rollback and no longer used by `runs.ts`)

## Rules
- No direct scraping or processing logic — that belongs in pipeline
- Communicate with pipeline only through DB and Redis queues / run-state
- Validate all API request input at the boundary with zod
- Use `@newsletter/shared` for DB access, types, Redis connection, and the logger factory
- Reuse `createRedisConnection()` from shared rather than instantiating ioredis directly
- User profiles are YAML files under `profiles/` at the repo root; override the lookup directory with `PROFILES_DIR` in deployed environments where the bundled source tree is not available. `POST /api/runs` accepts optional `profileName` and `halfLifeHours` fields that flow through to the pipeline's two-stage ranking.

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest)
pnpm test:e2e     # Run e2e tests (requires DB + Redis via `pnpm infra:up`)
