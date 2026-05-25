# Learnings — publishedat-newsletter-date

## 1. Stale worktree base made `git diff main` misattribute PR #190 as a revert

**Problem.** This worktree was branched from `main` at commit `52829d3` — *before* PR #190
(`10524b9 fix(api): dry-run archives accessible by direct link…`) merged to `origin/main`.
During code review, `git diff main...HEAD` therefore showed #190's changes as *removed* by this
branch, making the publish-date feature look like it reverted unrelated work. This is a pure
diff-base artifact, not a real change.

**Insight.** **When a worktree's local `main` ref is behind `origin/main`, a diff against
`main` attributes every commit merged upstream-after-branch as a deletion in your branch.** The
fix is to move the base forward (rebase onto `origin/main`), never to hand-copy the "missing"
files back in — hand-copying would duplicate upstream commits and create a real conflict later.

**Solution.** Fetched `origin/main` and confirmed the merge-base moved to `10524b9`:
```bash
git fetch origin main
git merge-base HEAD origin/main   # -> 10524b9 (current origin/main HEAD)
git diff --name-only origin/main...HEAD   # now shows ONLY the 24 feature files
```
After this, the diff was clean (24 files, all publish-date scope) with no #190 revert noise.

**Reuse.** Generalised into `.claude/rules/learnings/stale-worktree-base-diff-misattribution.md`.
Before reviewing a branch: `git fetch origin <base>` and diff with the three-dot form against
`origin/<base>`, not the local `<base>` ref.

## 2. Orphaned e2e seed rows in the shared dev DB break strict-UUID schema parsing

**Problem.** `archives.e2e.test.ts` failed 5/14 with `ZodError … Invalid UUID` on
`archives[0].runId` when parsing the full `GET /api/archives` response. Root cause: the shared
dev DB (port 5433) contained orphaned reviewed archives with synthetic non-v4 UUIDs
(`44444444-4444-4444-4444-444444444444`, `66666666-…`, `33333333-…`, etc.) and `completed_at`
in **2099** — abandoned e2e seeds from prior interrupted runs. They are `reviewed=true,
is_dry_run=false`, so they appear in the public listing and trip the strict
`archiveListResponseSchema` UUID regex (`[1-8]` version + `[89abAB]` variant nibbles).

**Insight.** **`cleanupSeeds()` in the e2e suite only deletes ids it tracked in an in-memory
`Set` (`seededRunIds`), so any crash / interrupt / timeout between seed and teardown orphans
those rows permanently in the shared DB.** A later, unrelated test that parses the *entire*
listing (not just its own seeds) then fails on the pollution — a failure that looks like a
feature regression but isn't. The quality gate must distinguish DB-pollution failures from real
regressions: check whether the failing row's id is one the feature touched.

**Solution.** Identified the orphans by their tell-tale 2099 dates and non-strict UUIDs, then
removed them (safe — 2099-dated synthetic seeds, no production dependency):
```sql
DELETE FROM email_sends WHERE run_archive_id IN (SELECT id FROM run_archives WHERE completed_at >= '2099-01-01');
DELETE FROM run_archives WHERE completed_at >= '2099-01-01';
```
`archives.e2e` then passed 14/14 and `run-flow.e2e` 7/7 — confirming the feature suite was
always green and the failures were pollution.

**Reuse.**
- When an e2e suite that parses a *whole* collection fails on schema validation, suspect shared-DB
  pollution before suspecting the feature. Grep the failing id against the feature diff.
- Consider hardening `cleanupSeeds` to also delete by a stable marker (e.g. all `completed_at >=
  '2099-01-01'` synthetic rows) in a `beforeAll`, so a prior crash self-heals on the next run.

## 3. Pipeline e2e flakiness (known, pre-existing)

`collection.e2e.test.ts` + `daily-run.e2e.test.ts` and intermittent BullMQ timing flakes fail
identically on a clean baseline and are unrelated to this feature. The feature's own e2e suites
(`run-flow.e2e` seam, `archives.e2e`) are deterministic and green on a clean DB. When running the
full `pnpm test:e2e`, scope verification to the feature's suites rather than treating the whole
project e2e exit code as the gate signal.
