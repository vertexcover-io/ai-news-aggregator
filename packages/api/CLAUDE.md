# @newsletter/api

Hono REST API for job enqueueing and email delivery.

## Responsibilities
- HTTP route handlers and middleware
- Enqueue `run-process` jobs to the Redis `processing` queue via `Queue.add` with `jobId: runId`
- Send digest emails via Resend (future)
- Serve as the backend for the React frontend

## Layout
- `src/routes/` — Hono route modules (e.g. `runs.ts` for `/api/runs`)
- `src/services/` — business logic invoked by routes (`runs.ts` seeds Redis run-state and enqueues the single run-process job; `rank-hydration.ts` joins ranked IDs to `raw_items`)
- `src/lib/` — package-private helpers (`validate.ts` is the zod request-schema layer; `flow.ts` is a legacy `FlowProducer` helper kept in place for rollback and no longer used by `runs.ts`)

## Rules
- No direct scraping or processing logic — that belongs in pipeline
- Communicate with pipeline only through DB and Redis queues / run-state
- Validate all API request input at the boundary with zod
- Use `@newsletter/shared` for types, Redis connection, and the logger factory
- Reuse `createRedisConnection()` from shared rather than instantiating ioredis directly
- DB access goes through `src/repositories/` — routes and services import repository factories, not `@newsletter/shared/db` or `drizzle-orm` directly (enforced by `newsletter/enforce-repository-access`)

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest)
pnpm test:e2e     # Run e2e tests (requires DB + Redis via `pnpm infra:up`)
