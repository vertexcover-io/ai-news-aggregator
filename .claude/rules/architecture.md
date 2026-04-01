# Architecture

## Spec documents are the source of truth

Always check `docs/superpowers/specs/` before making architectural decisions. Don't contradict what's documented there. If a spec is outdated, flag it to the user rather than silently deviating.

## Monorepo package boundaries

Each package has a clear responsibility. Don't leak concerns across boundaries:

- **`@newsletter/shared`** — owns all Drizzle schema definitions, migrations, shared types, and the DB client. This is the only package that defines database tables.
- **`@newsletter/api`** — HTTP layer only. Route handlers, auth middleware, job enqueueing, email delivery via Resend. No direct scraping or processing logic.
- **`@newsletter/pipeline`** — BullMQ workers only. No HTTP framework (no Express, no Hono). Runs as a standalone Node process.
- **`@newsletter/web`** — React UI only. Communicates with the backend exclusively through the typed API client. No direct DB access.

Import shared code through workspace references (`@newsletter/shared`), never via relative paths across package boundaries.

## Deferred decisions

The following have NOT been decided yet. Do not assume or introduce:
- Scraping libraries or approaches (how sources are collected)
- AI/LLM SDKs or models (for summarization, ranking, filtering)
- Embedding models (for deduplication)
- Deployment target (VPS, serverless, Docker, etc.)

If a task requires one of these, ask the user before proceeding.

## No scope creep

- Don't add packages, services, or infrastructure not described in the spec
- Don't "improve" adjacent code while working on a task
- Don't add features beyond what was explicitly asked for
- If you notice something that should change, flag it — don't silently fix it
