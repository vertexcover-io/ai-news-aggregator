# Learnings — run-observability-page

## 1. `HARNESS_DIR` claims-location split: `.harness/` lived in the main repo, not the worktree

**Problem.** The orchestrate pipeline ran in the worktree
`.worktrees/run-observability-page/`, but the aggregated `claims.json` (and the
phase `phase-*.md` / `baseline.json`) were written under
`.harness/run-observability-page/`. Verification needed to read `claims.json`
from the worktree path; it resolved because the worktree was created as a
sibling that shares the repo's `.harness/` tree, but the split (code in the
worktree, harness scratch in the repo root) is a foot-gun: a glob for
`.harness/**` from the worktree CWD can miss or double-count depending on how
the worktree was created.

**Insight.** Pipeline scratch (`.harness/<spec>/`) and reviewer artifacts
(`docs/spec/<spec>/`) have *different* lifecycles and *different* roots. The
reviewer artifacts are committed and must live in the worktree; the harness
scratch is gitignored and may live at the repo root the worktree branched from.
Always resolve `.harness/<spec>/claims.json` with an explicit absolute path
derived from the spec name, never a CWD-relative glob.

**Prevention.**
- When a step says "read `.harness/<spec>/claims.json`", confirm the file
  exists with `ls` before globbing; if absent in the worktree, check the parent
  repo root.
- Keep committed evidence (`docs/spec/<spec>/verification/`) strictly in the
  worktree so it lands in the PR; keep `.harness/` out of the PR.

## 2. Adding `runFunnel` to the archive upsert input broke a stale unit assertion

**Problem.** Phase 2 added an optional `runFunnel` field to
`RunArchiveUpsertInput` and wrote it on both the insert and the
`onConflictDoUpdate` set clause. A pre-existing
`packages/pipeline/tests/unit/repositories/run-archives.test.ts` assertion that
deep-equaled the *whole* upsert payload (or the generated SQL column set) then
failed, because the column set grew by one — even though the change was purely
additive and backward-compatible.

**Insight.** **A unit test that asserts the exact shape of a write payload is a
change-detector, not a behavior test — it breaks on every additive column even
when nothing it cares about changed.** The fix is to assert the *fields the test
is about* (e.g. "the funnel landed", "status is completed"), not the entire
serialized row.

**Solution.** The assertion was narrowed to check the specific fields under test
rather than the full object. The additive `runFunnel` write is covered by its
own dedicated assertion (PHASE2-C11) and by the live e2e
(`run-flow.e2e.test.ts`).

**Prevention.**
- When adding an optional field to an upsert/insert input type, grep the repo's
  unit tests for full-payload equality (`toEqual(`/`toStrictEqual(` against the
  insert arg) and narrow them to per-field assertions in the same change.
- See the existing learning
  `.claude/rules/learnings/partial-update-db-writers-precondition.md` — here the
  funnel was correctly written *inside the finalize upsert* (row guaranteed),
  not via a standalone partial UPDATE, so the partial-update foot-gun was
  avoided.

## 3. Cross-worktree shared-Postgres interference during live verification

**Problem.** During the functional-verify adversarial pass, seeded
`run_archives` rows disappeared between probes. Investigation (`ps` + API dev
logs) showed *other* git worktrees (`fix-dry-run-archive-access`,
`fix-reviewed-digest-regeneration`) running their full `test:e2e` /
quality-gate suites against the **same shared Postgres on :5433** — those suites
truncate/delete `run_archives` (`archive.deleted` log events, `run-flow-e2e`
worker activity), wiping this feature's seed data mid-verification.

**Insight.** This was NOT a defect in the observability feature; it was test
infrastructure cross-talk on a shared database. But it nearly produced a false
FAIL. Reusable pattern extracted to
`docs/solutions/workflow-issues/shared-db-cross-worktree-test-interference-20260525.md`.

**Prevention (this spec).**
- Re-seed scenario rows immediately before each UI/probe batch; do not assume a
  row that existed five tool-calls ago still exists.
- The `mcp__postgres__query` MCP points at `:5432`; the project DB is `:5433` —
  use `psql -h localhost -p 5433` for direct DB checks, not the MCP.
