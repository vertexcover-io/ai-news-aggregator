# Run UI Smoke Test

`scripts/smoke-run.sh` exercises the full `/api/runs` happy path against a
live development stack. It posts an HN+Reddit run, polls the run-state, and
prints the final hydrated payload.

## Prerequisites

1. Local infrastructure up:
   ```bash
   pnpm infra:up
   ```
2. Database migrated:
   ```bash
   pnpm --filter @newsletter/shared db:migrate
   ```
3. All services running (in another shell):
   ```bash
   pnpm dev
   ```
4. Environment exported in the shell that runs the script:
   - `ADMIN_PASSWORD` — same value the API uses for the password middleware
   - `GEMINI_API_KEY` — required by the pipeline worker for ranking
   - Optional: `API_URL` (default `http://localhost:3000`),
     `POLL_ATTEMPTS` (default 30), `POLL_INTERVAL_SECONDS` (default 2)

## Run it

```bash
ADMIN_PASSWORD=devpass GEMINI_API_KEY=sk-... ./scripts/smoke-run.sh
```

Expected output ends with `run completed:` followed by the JSON state
including a non-empty `rankedItems` array.

## Reviewer note

The integration test suite at `packages/pipeline/tests/e2e/run-flow.e2e.test.ts`
covers the same flow against real Redis + Postgres without needing a live API.
Run it with:

```bash
pnpm infra:up
pnpm --filter @newsletter/pipeline test:e2e
pnpm --filter @newsletter/api test:e2e
```
