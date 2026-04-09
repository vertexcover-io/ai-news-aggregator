# Copy uncommitted design/SPEC docs into the worktree before starting an orchestrate run

The `harness:orchestrate` pipeline creates a git worktree off the current branch and dispatches sub-agents there. If the brainstorm/design doc and SPEC that describe the feature are still uncommitted in the main workspace (only live in the dirty working tree), they will NOT be present inside the new worktree — the worktree is branched from a commit, not from working-tree state. Sub-agents then start work without the artifacts they're supposed to implement and either fabricate substitutes or stall asking for context.

Before invoking orchestrate, either:

1. **Commit the design doc + SPEC to the base branch first** (preferred — they're meant to ship with the PR anyway per the project's "always commit spec and design docs" rule), or
2. **Copy the files into the worktree explicitly** after creation:
   ```bash
   cp -r docs/plans/<date>-<feature>.md .worktrees/<feature>/docs/plans/
   cp -r docs/spec/<feature>/  .worktrees/<feature>/docs/spec/
   ```

The orchestrate bootstrap should verify that the referenced design doc path resolves inside the new worktree and bail out with a clear error if it doesn't, so this trap gets caught before sub-agents are spawned.

Why: In the custom-eslint-plugin run, the design doc (`docs/plans/2026-04-08-custom-eslint-plugin-design.md`) and SPEC directory (`docs/spec/custom-eslint-plugin/`) were uncommitted in main when orchestrate launched. The new worktree was branched from a clean commit that predated both files, so phase 1 started with no artifacts and the operator had to `cp` the files in manually before work could resume. This is the second time this has happened during an orchestrate run, and it's mechanical enough to automate or guard.

Enforced by: manual operator check; orchestrate bootstrap should validate design-doc path exists in worktree
