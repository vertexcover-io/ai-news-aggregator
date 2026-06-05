# @newsletter/pipeline

BullMQ workers that collect, process, rank, and publish newsletter items. Standalone Node process — no HTTP framework, ever.

Collector/processor/worker/service surface and decisions: `.harness/knowledge/context/packages/pipeline/PACKAGE.md` (+ sub-docs for `collectors/`, `processors/`, `workers/`, `services/`, `social/`, `eval/`).

## Rules
- No HTTP framework — this is a standalone worker process
- Workers call plain collector/processor functions — no business logic in workers
- Use repository factories (e.g. `createRawItemsRepo(db)`) for DB access — value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside `src/repositories/**` (enforced by `newsletter/enforce-repository-access`)
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- Do NOT set worker-level `concurrency: 1` on the processing worker — it dispatches 6+ job types and would serialize them all; in-process pacers (e.g. the email `SendPacer`) are the rate guards. See `.claude/rules/learnings/queue-concurrency-vs-in-process-pacer.md`
- Publish/credential deps are built **per job** (not at worker startup) so admin saves at `/admin/settings` take effect on the next job without a restart — preserve this pattern
- `ANTHROPIC_API_KEY` is validated at worker startup (not per job); `RANKING_MODEL` defaults to `claude-haiku-4-5-20251001`
- **Archive-level idempotency markers are broadcast-only.** `run_archives.email_sent_at` / `linkedin_posted_at` / `twitter_posted_at` and every `notification_state` key are written ONLY from the canonical scheduled/broadcast path. Targeted/per-recipient/manual variants MUST short-circuit before stamping them (per-recipient dedup belongs on `email_sends`) — see commit 60d748b
- On a Slack/webhook failure, never write the notification idempotency marker — that is what allows a retry to re-alert

## Path Aliases
- `@pipeline/*` → `src/*` (tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
