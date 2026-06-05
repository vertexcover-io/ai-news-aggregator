# Learnings — regenerate-digest-meta

## HARNESS_DIR pointed at the main checkout, not the worktree

The Phase 3 coder agent wrote `phase-3-claims.json` / `phase-3-e2e-vitest.json` to the **main checkout's**
`.harness/regenerate-digest-meta/` instead of the worktree's, which orchestrate had to reconcile (copy into
the worktree) before claim aggregation + verify could find them. Globally-reusable write-up + the durable
fix (derive `HARNESS_DIR` from `git rev-parse --show-toplevel` inside each phase agent; assert the phase
claims file exists in the worktree before proceeding):

→ `docs/solutions/workflow-issues/harness-dir-must-be-worktree-relative-20260527.md`

## Verification note (not a code learning)

Severity `medium`, so not surfaced in CLAUDE.md Critical gotchas. The feature itself was clean across
functional-verify (PASS, 6 UI claims screenshotted, 15 adversarial scenarios, 0 defects) and quality-gate
(PASS, all 9 checks). The only verification-time gotcha worth remembering: seeding archives with
**non-canonical UUIDs** (e.g. `aaaaaaaa-bbbb-cccc-dddd-…`) pollutes the public `GET /api/archives` listing
and breaks the listing e2e tests' response-schema validation (`ZodError: archives[N].runId Invalid UUID`).
Use canonical v4 UUIDs for any seed row that can appear in a public listing, and clean seeds before running
the e2e suite against the shared DB.
