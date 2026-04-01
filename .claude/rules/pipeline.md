---
paths:
  - "packages/pipeline/**/*.ts"
---

# Pipeline Rules

## BullMQ jobs

- Jobs must be idempotent — safe to retry without side effects (duplicate data, duplicate emails, etc.)
- Keep job payloads small — store data in PostgreSQL, pass record IDs in the job payload
- Always set retry limits and backoff strategy on queue/worker configuration
- Each collector and processor is a plain function — BullMQ workers just call these functions, they don't contain business logic themselves

## Workers

- Workers run in a standalone Node process with no HTTP framework
- Don't import from `@newsletter/api` — pipeline and API communicate only through the database and Redis queues
- If a collector fails, log the error and let other collectors continue — partial collection is acceptable
