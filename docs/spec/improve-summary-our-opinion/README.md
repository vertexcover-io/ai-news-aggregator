# improve-summary-our-opinion

**Verdict:** PASS — [verification/proof-report.md](verification/proof-report.md)
**PR:** _(filled in after push)_

## Summary

Restructures the two recap-generation LLM prompts (`processors/rank-prompts.ts` and `processors/recap.ts`) so the model first forms our editorial stance on each story and then writes `bullets` and `bottomLine` through that stance. `summary` keeps its factual ORIENT role (the load-bearing italic lede on the archive UI). Both prompts share a single exported `RECAP_VOICE_BLOCK` constant so they cannot drift; a hard `DO NOT` list and Bad→Good examples in the prompt forbid echoing the source author's framing or opinion. No schema changes, no DB migrations, no UI changes.

## Library probe

- **Verdict:** NOT_APPLICABLE — prompt-only change; no new external libraries, models, or APIs. See [library-probe.md](library-probe.md).

## Artifacts

| File | What it is |
|---|---|
| [design.md](design.md) | Problem, goal, prompt-architecture change, risks |
| [spec.md](spec.md) | EARS requirements REQ-001..REQ-010 + verification scenarios VS-1..VS-6 |
| [plan.md](plan.md) | Single-phase implementation plan |
| [library-probe.md](library-probe.md) | Library-probe verdict (NOT_APPLICABLE / PASS) |
| [verification/proof-report.md](verification/proof-report.md) | Verification verdict with per-claim evidence |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Step-5 adversarial pass |
| [learnings.md](learnings.md) | Pipeline learnings captured this run |
