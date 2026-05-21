# E2E Archives Social Collectors

**Verification:** PASS — see [verification/proof-report.md](verification/proof-report.md)

This change closes the remaining E2E audit gaps for archive HTTP routes, review-page remove/inline-edit flows, LinkedIn and Twitter social-post workers, the daily-run scheduler, the Twitter collector, and the Tavily web-search collector. It also includes two narrow behavior fixes exposed by the tests: public archive detail hides unreviewed archives, and review save navigation no longer trips the unsaved-change guard after a successful save.

## Artifacts

| Artifact | Purpose |
|---|---|
| [design.md](design.md) | Original design and dependency policy |
| [library-probe.md](library-probe.md) | External dependency probe verdict |
| [spec.md](spec.md) | Acceptance criteria and verification scenarios |
| [plan.md](plan.md) | Coder phase split and test ownership |
| [learnings.md](learnings.md) | Pipeline-specific gotchas captured during delivery |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification proof |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Adversarial verification scenarios |
| [verification/quality-gate.md](verification/quality-gate.md) | Final quality gate evidence |

## Library Probe

`<!-- LP:VERDICT:PASS -->` with `NOT_APPLICABLE / msw-only`: LinkedIn, Twitter posting, and rettiwt surfaces are mocked for these tests; Tavily remains live-capable but is skipped by the test process when `TAVILY_API_KEY` is absent; `msw@2.7.0` was already resolved in the lockfile and is now a direct devDependency for API and pipeline.

## PR

Pending.
