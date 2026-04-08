# @newsletter/api

Hono REST API for job enqueueing and email delivery.

## Responsibilities
- HTTP route handlers and middleware
- Enqueue collection/processing flows to Redis using a BullMQ `FlowProducer`
- Send digest emails via Resend (future)
- Serve as the backend for the React frontend

## Layout
- `src/routes/` — Hono route modules (e.g. `runs.ts` for `/api/runs`)
- `src/services/` — business logic invoked by routes (`runs.ts` enqueues runs and reads run-state; `rank-hydration.ts` joins ranked IDs to `raw_items`)
- `src/lib/` — package-private helpers (`flow.ts` builds the BullMQ flow tree, `validate.ts` is the zod request-schema layer)

## Rules
- No direct scraping or processing logic — that belongs in pipeline
- Communicate with pipeline only through DB and Redis queues / run-state
- Validate all API request input at the boundary with zod
- Use `@newsletter/shared` for DB access, types, Redis connection, and the logger factory
- Reuse `createRedisConnection()` from shared rather than instantiating ioredis directly

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest)
pnpm test:e2e     # Run e2e tests (requires DB + Redis via `pnpm infra:up`)
