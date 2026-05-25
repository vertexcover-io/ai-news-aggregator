# A stale worktree base makes `diff vs main` misattribute upstream commits as reverts

When a feature worktree was branched from a local `main` that is now behind `origin/main`,
`git diff main...HEAD` (or any review tool diffing against the local `main` ref) reports every
commit that merged upstream *after* you branched as a **deletion** in your branch. The feature
then looks like it reverted unrelated work — a code-review false-positive.

## What bit us

The `publishedat-newsletter-date` worktree was branched from `main` at `52829d3`, before PR #190
(`10524b9 fix(api): dry-run archives accessible by direct link, hidden from listing`) merged to
`origin/main`. Reviewing with `git diff main...HEAD` showed #190's changes as removed by this
branch. They weren't — the branch simply predated #190. The "missing" files were upstream work
the local `main` ref hadn't caught up to.

## Rule

Before reviewing or quality-gating a branch, **refresh the base ref and diff against the remote**,
never the local ref:

```bash
git fetch origin <base>                    # usually: git fetch origin main
git merge-base HEAD origin/<base>          # should be at-or-near origin/<base> HEAD
git diff --name-only origin/<base>...HEAD  # three-dot: changes on YOUR side since the merge-base
```

If the merge-base is far behind `origin/<base>` HEAD, the branch is stale. **Fix it by rebasing
onto `origin/<base>`** (`git rebase origin/<base>`). Do **NOT** "restore" the apparently-deleted
files by hand-copying them from `origin/<base>` — that re-applies upstream commits as if they were
yours, duplicating history and guaranteeing a conflict at merge time.

## Heuristic

If a diff shows a branch deleting code that has nothing to do with the feature — especially code
matching a recently-merged PR's description — your first hypothesis should be "stale base," not
"the author reverted this." Confirm with `git merge-base HEAD origin/<base>` before raising it as
a review finding. The three-dot diff (`A...B`) against the *remote* base is the artifact-free view.

## Related

- `.claude/rules/learnings/cache-vs-spec-promise-review.md` — another "start the review from the
  right vantage point" lesson (walk from the user-visible promise; here, diff from the remote base).
