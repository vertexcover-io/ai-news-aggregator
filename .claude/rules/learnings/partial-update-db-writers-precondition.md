# Partial-update DB writers must document and verify their row-must-exist precondition

When adding a new DB writer that performs a *partial* UPDATE (e.g. `UPDATE run_archives SET cost_breakdown = $1 WHERE id = $2`), the silent-no-op-on-missing-row failure mode is invisible at runtime but catastrophic for data correctness.

## What bit us

`setCostBreakdown(runId, breakdown)` was added to `packages/api/src/repositories/run-archives.ts` (mirrored in pipeline) as an UPDATE-only operation. On the success path of `handleRunProcessJob`, the run_archives row is created earlier by the finalize step, so the UPDATE landed correctly.

But on the **failure paths** (`run.failed` mid-stage, all-collectors-failed, etc.) the archive row is NOT yet created when `setCostBreakdown` runs — the UPDATE silently affected 0 rows and the partial cost was lost. This was caught only in code review (commit `6e99901`).

## Rule

When you add a partial-update writer like `set<Field>(id, value)`:

1. **Document the precondition** in JSDoc on the function signature: "Requires the row to exist; callers must INSERT first on paths where the row may not exist."
2. **Audit every caller** — especially error/cancel/cleanup paths where the row creation order may differ from the happy path.
3. **Write an e2e test for the failure path explicitly** — not just success. The cost-tracking feature now has three: `run.failed before any stage`, `rank-failed with prior tokens`, `all-collectors-failed with prior tokens`.
4. **Consider returning `rowsAffected` from the writer** so callers can detect the silent no-op in tests / metrics.

## Heuristic

If you're about to write `UPDATE … SET … WHERE id = $1`, ask: "Is there any code path that calls this where the row may not exist yet?" If the answer is "probably not" — that's the answer that needs an explicit test, not the answer that needs trust.
