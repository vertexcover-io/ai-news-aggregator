# @newsletter/api

Hono REST API for job enqueueing, auth, and email delivery.

## Responsibilities
- HTTP route handlers and middleware
- Auth (simple password for MVP)
- Enqueue collection/processing jobs to Redis via BullMQ
- Send digest emails via Resend
- Serve as the backend for the React frontend

## Rules
- No direct scraping or processing logic — that belongs in pipeline
- Communicate with pipeline only through DB and Redis queues
- Validate all API request input at the boundary
- Use @newsletter/shared for DB access and types

## Commands
pnpm dev          # Start dev server
pnpm build        # Build with tsup
pnpm typecheck    # Type check
