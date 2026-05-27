# Sub-agents in a git worktree resolve `.harness/` to the MAIN checkout, not the worktree

When the orchestrate pipeline runs inside a git **worktree** and `.harness/<SPEC_NAME>/` is
**gitignored**, sub-agents (coder, reviewer) that write artifacts like `phase-2-claims.json` or
review reports land them in the **main repository's** `.harness/`, not the worktree's. The
orchestrator then can't find them at aggregation time and has to hand-copy them into the worktree.

## What bit us

The `cheaper-discovery-extraction` feature ran in `.worktrees/cheaper-discovery-extraction`. Phase-2
sub-agents wrote `phase-2-claims.json` + code-review reports into the **main repo** `.harness/`
directory. Aggregation (which reads from the worktree's `.harness/`) saw nothing until the
orchestrator manually copied the files across.

## Why it happens

A git worktree shares the `.git` object store with the main checkout via `git-common-dir`. A
gitignored path like `.harness/` is **not** materialised independently per worktree the way tracked
files are — and any tool that resolves the artifact path by walking up to "the repo root" can land on
the main checkout's root instead of the worktree root, depending on how it derives root (e.g.
`git rev-parse --show-toplevel` from a sub-process whose cwd drifted, or a `--git-common-dir`-based
resolution). The result: absolute-path resolution from a sub-agent's cwd lands in the main checkout.

## Rule

When an orchestrate stage spawns sub-agents that write to `.harness/<SPEC_NAME>/` from within a
worktree:

1. **Pass the worktree-absolute `.harness/<SPEC_NAME>/` path explicitly** to each sub-agent (e.g.
   `$WORKTREE/.harness/<SPEC_NAME>/...`), and instruct them to write there — do not let them derive
   "repo root" themselves.
2. **At aggregation, verify the files exist in the worktree `.harness/` before reading.** If absent,
   check the main checkout's `.harness/` (`$(git rev-parse --git-common-dir)/../.harness/...`) and
   copy them in — this is the known failure mode, not a missing artifact.
3. **Prefer worktree-relative paths** in sub-agent prompts over "find the repo root and append".

## Heuristic

If an orchestrate run in a worktree reports "claims/report not found" at aggregation but the
sub-agent logged a successful write, your first check is the **main checkout's** `.harness/` — the
artifact is almost certainly there, not lost. Gitignored + worktree + sub-agent cwd = path lands in
the shared common-dir root.
