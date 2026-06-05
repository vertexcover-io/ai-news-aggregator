# Review Page Robustness Fixes

> **Verification verdict:** PASS — [verification/proof-report.md](verification/proof-report.md)
> **Quality gate:** PASS (9/9 checks)
> **PR:** _pending_

Fixes the two operator-reported review-page incidents and nine additional audit
defects, all in `packages/web`: the Item Pool section no longer vanishes (toolbar
included) when a filter matches zero items; pool/facets/archive query failures now
surface inline errors with Retry instead of settling silently into wrong states
("kept loading, nothing happened"); dry-run reviews can no longer deadlock behind
the regenerate-before-save gate; digest-meta edits are dirty-tracked (unsaved count,
navigation blocker, discard); removed promoted items return to the pool; and
in-progress runs poll into the review view automatically.

## Artifacts

| Artifact | Purpose |
|---|---|
| [design.md](design.md) | Root-cause audit (11 findings) + chosen approach |
| [spec.md](spec.md) | EARS requirements REQ-001…017, EDGE-001…007, verification matrix (24 rows) |
| [plan.md](plan.md) | 4-phase implementation plan + codebase context |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — pure-internal feature, no external deps |
| [verification/proof-report.md](verification/proof-report.md) | 21 UI claims independently proven via live-browser screenshots |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | 15 adversarial scenarios attempted, 0 defects |
| [verification/screenshots/](verification/screenshots/) | Per-claim browser evidence (22 files) |

## Library probe

No external dependencies declared or probed (web-only fixes against already-installed
react / react-query / react-router).

## Test summary

- 109 phase-test executions, 0 failures (unit jsdom + Playwright e2e)
- Web unit suite: 854 tests green (baseline 821); full monorepo unit suite green
- New e2e: dry-run reorder → Regenerate disabled → Save succeeds (EDGE-004)
- Code review: 2-pass, final verdict APPROVE (2 Important defects found in pass 1, fixed, re-verified)
