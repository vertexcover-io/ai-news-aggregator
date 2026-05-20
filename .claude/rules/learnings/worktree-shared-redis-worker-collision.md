# Multiple git worktrees + shared Redis = stale worker can swallow jobs

When working in a git worktree that shares Redis/Postgres with other worktrees of the same repo, **a BullMQ worker running from a different worktree can pick up jobs you enqueue from the current worktree** — and route them through stale/older code that doesn't know about your changes.

## What bit us

While verifying the `web-search-collector` feature (Stage 5), `POST /api/runs/now` enqueued a run that sat at `status: running, stage: queued` for 90+ seconds. The API in the current worktree was healthy; the run-process worker on the same Redis was the one from a **different worktree** (`feat-admin-pipeline-cost-analysis`) that didn't have the `web-search` collector at all. The worker was picking up jobs, but the routing path didn't exist for the new collector, so the run hung.

Killing the stale worker (`kill <PID>`) and starting `pnpm --filter @newsletter/pipeline dev` from the current worktree immediately drained the queued job and the run completed in ~50 seconds.

## Rule

Before claiming any functional verification involving the BullMQ pipeline in a multi-worktree setup:

1. **List all pipeline workers:** `ps aux | grep "src/index.ts" | grep -v grep` (or `pgrep -f "src/index.ts"`).
2. **Verify the cwd of the live worker matches the worktree under verification.** The `--require .../<worktree>/node_modules/.pnpm/tsx@…/preflight.cjs` substring in the ps output reveals the worktree.
3. If a stale worker exists, **kill it** before triggering a job, then start the fresh worker.
4. If you can't kill it (someone else's session), enqueue against a **separate Redis instance** (e.g. set `REDIS_URL` to a different DB number for this worktree) — don't try to share with a stale consumer.

## Heuristic for the harness

The pipeline-setup skill or the verify stage's pre-flight should add a check: "is there exactly one BullMQ worker process bound to this worktree's node_modules?" If 0 or >1, fail-fast with a clear message before running any e2e or verification scenario.
