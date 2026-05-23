# Learnings — eval-report-component

## Pipeline friction

- **Phase 2 coder sub-agent claimed-but-didn't-write artifacts.** It reported writing a
  `phase-2-claims.json` + Vitest JSON, but wrote neither to the harness dir — the Vitest
  JSON went to a relative `packages/web/.harness/` path (resolved against the per-package
  CWD), and the claims file was absent. The orchestrator had to regenerate the claims
  file and re-run tests. Reusable rule extracted to
  `docs/solutions/orchestration/verify-subagent-artifact-claims-independently.md`
  (verify artifacts on disk at absolute paths; mandate absolute `--outputFile`).

## Verification-specific notes

- **Pre-existing eval_runs rows predated the feature and carried NULL `poolSize`.** All 5
  rows in the shared DB were created before the `poolSize` change, so they could only
  prove the legacy/graceful-degradation path. The funnel's core "Sent for ranking" claim
  required producing FRESH runs through the real UI + LLM ranker (Mode A scored
  poolSize=15, Mode B calendar poolSize=40). Lesson: when a feature adds an *optional*
  persisted field, existing fixtures will all be on the legacy branch — budget for
  generating fresh data to prove the populated branch.

- **Shared-DB / shared-port contention across worktrees.** This worktree's `.env`
  symlinks to the root `.env` (DB :5433, Redis :6379), and ports 3000/5173 were held by
  another worktree. Ran api on `API_PORT=3010` + web on an alternate Vite port with a
  temporary (since-reverted) `VITE_API_PORT` proxy shim. The `pnpm test:e2e` failures
  (runs/settings/web-prompt e2e) all traced to this shared-DB pollution + pre-existing
  test brittleness in files byte-identical to `main` — NOT feature regressions. Lesson:
  when multiple worktrees share one Postgres, e2e suites that seed/read global rows
  (`user_settings` singleton, `raw_items` for hydration) are unreliable; classify by
  `git diff main..HEAD` on the failing test's source files before calling a regression.
