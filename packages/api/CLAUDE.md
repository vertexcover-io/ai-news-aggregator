# @newsletter/api

Hono REST API: route handlers, admin auth, settings, review/curation mutations, run enqueueing (BullMQ `Queue.add` with `jobId: runId`), and email delivery.

Route/service/repository surface and decisions: `.harness/knowledge/context/packages/api/PACKAGE.md` (+ sub-docs for `routes/`, `services/`, `repositories/`, `lib/email/`).

## Rules
- No scraping or processing logic — that belongs in pipeline; communicate with pipeline only through DB and Redis queues / run-state
- Validate all API request input at the boundary with zod (`src/lib/validate.ts`)
- DB access goes through `src/repositories/` — routes and services import repository factories, never `@newsletter/shared/db` or `drizzle-orm` directly (enforced by `newsletter/enforce-repository-access`)
- Reuse `createRedisConnection()` from shared rather than instantiating ioredis directly
- Public vs admin split: archives list/detail/search, sources summary, home, must-read, the llm.txt files (`/llms.txt`, `/llms-full.txt`, `/api/archives/:runId/llm.txt`), and login/logout are public; everything else goes behind `requireAdmin`. Exception: the LinkedIn OAuth callback is state-gated (Redis CSRF), not cookie-gated
- Admin-only fields (`costBreakdown`, raw `publishedAt`, `reviewed`, `draftSavedAt`, send/post timestamps) must never be serialized on public routes — public surfaces only get derived dates (`runDate`/`issueDate`)

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest)
pnpm test:e2e     # Run e2e tests (requires DB + Redis via `pnpm infra:up`)
