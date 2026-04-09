# Phase 8: Docs sync + learning footers + CLAUDE.md polish

> **Status:** pending

## Overview

Close the loop: annotate the `.claude/rules/learnings/*.md` files that are now enforced by plugin rules, update root `CLAUDE.md` with a brief mention of the plugin, and make sure `docs/rules/README.md` has the complete rule index. No code changes.

## Implementation

**Files to modify:**
- `.claude/rules/learnings/always-load-dotenv-in-package-entrypoint.md` — append footer line: `Enforced by: newsletter/dotenv-bootstrap`
- `.claude/rules/learnings/bundled-assets-need-import-not-readfilesync.md` — append: `Enforced by: newsletter/no-bundled-readfilesync`
- `.claude/rules/learnings/lock-ai-sdk-versions-explicitly.md` — append: `Enforced by: tools/check-repo-invariants.ts (ai-sdk-alignment + package-json-pinning)`
- `.claude/rules/learnings/exclude-vitest-config-from-tsc-build.md` — append: `Enforced by: tools/check-repo-invariants.ts (vitest-config-excluded)`
- `.claude/rules/database.md` — append: `Note: raw ALTER TABLE via db.execute() is enforced by newsletter/no-raw-alter-table.`
- `.claude/rules/architecture.md` — append a line to the "Collector pattern" and "Monorepo package boundaries" sections noting the enforcing rules
- `.claude/rules/pipeline.md` — append line noting `no-restricted-imports` enforcement for HTTP frameworks and `@newsletter/api`
- `CLAUDE.md` (root) — add a one-line mention of `@newsletter/eslint-plugin` under "Available Tools" or as a new section "Custom lint rules"
- `packages/eslint-plugin/docs/rules/README.md` — final pass: confirm every shipped rule appears in the index with a one-line description

**Files NOT to modify:**
- Existing learning files should only receive the footer line — do not rewrite content
- `.claude/rules/learnings/run-lint-during-coding-not-just-review.md` — not mechanically enforceable (behavioral), no footer
- `.claude/rules/learnings/run-all-packages-not-one.md` — behavioral, no footer
- `.claude/rules/learnings/parallel-agents-need-isolated-worktrees.md` — orchestration, no footer
- `.claude/rules/learnings/test-exact-spec-mandated-strings.md` — behavioral, no footer

### `/extract-learnings` skill update (REQ-092)

Search for the skill's source — likely under `.claude/skills/extract-learnings/` or in a plugin cache. If locatable within the repo, append a step to its instructions:

> **If the captured learning is mechanically enforceable** (can be detected via AST matching, type checking, file-shape check, or string matching), draft a rule stub under `packages/eslint-plugin/src/rules/<slug>.ts` or a check function under `tools/invariants/<slug>.ts` in the same commit. Leave the stub as a TODO with a link to the learning file; a human reviewer promotes it.

If the skill file is not in this repo (managed externally via the harness plugin cache), document the intended change in `docs/plans/custom-eslint-plugin/followups.md` so a human can apply it out-of-band and skip that file mutation in this phase.

## What to verify

- [ ] `grep -rn "Enforced by: newsletter/" .claude/rules/` returns the expected 5+ entries
- [ ] Root `CLAUDE.md` has a mention of the plugin
- [ ] `packages/eslint-plugin/docs/rules/README.md` lists all 5 custom rules + decision tree
- [ ] No broken links in the docs (spot-check the `meta.docs.url` paths)

**Traces to:** REQ-090, REQ-091, REQ-092

**Commit:** `docs(VER): link learnings to their enforcing lint rules`

## Done When

- [ ] All listed files modified with the footer/mention lines
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` still pass (no code changes, so this is a formality)
- [ ] The rule index in `docs/rules/README.md` is complete and accurate
- [ ] If `/extract-learnings` skill was modified, the change is documented in the commit; if not, `docs/plans/custom-eslint-plugin/followups.md` captures the open task
