# LinkedIn post: top-5 stories + fixed header + review-page preview

**Verification:** PASSED — see [verification/proof-report.md](verification/proof-report.md).

## Summary

LinkedIn auto-post now uses a deterministic, brand-consistent format: a constant header (`AgentLoop — Today in Agentic Engineering`), up to 5 arrow-bulleted ranked stories (`recap.summary` per bullet), and a `Full newsletter linked in the comments.` footer. The header is admin-editable per-archive via the review page's Meta Digest panel, which also renders a live preview of the post body. Twitter behaviour is unchanged.

## Artifacts

- [design.md](design.md) — problem, design, fallback rationale.
- [spec.md](spec.md) — EARS requirements + verification scenarios.
- [library-probe.md](library-probe.md) — NOT_APPLICABLE (no new external libs).
- [verification/proof-report.md](verification/proof-report.md) — REQ→test mapping.
- [verification/adversarial-findings.md](verification/adversarial-findings.md) — edge cases + open risks.

## Library probe

NOT_APPLICABLE — feature changes only internal code (shared constants, pipeline composer, web component, archive write).

## PR

_To be filled in after `gh pr create`._
