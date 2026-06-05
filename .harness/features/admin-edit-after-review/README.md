# Edit a newsletter after review is done

**Verification verdict:** PASS — [verification/proof-report.md](verification/proof-report.md) (13 claims proven, every UI claim with an independent Playwright MCP screenshot; quality gate 9/9 PASS — [verification/quality-gate.md](verification/quality-gate.md))

An admin can re-enter the existing review page for any reviewed run via a kebab-menu "Edit newsletter" item on each dashboard run row. The item is enabled only for `completed + reviewed` runs (dry-runs included) and disabled for ready-to-review / running / failed / cancelling / cancelled. The review page presents itself in edit mode (`Edit · <date>` heading) and shows a banner naming channels that already published (Email / LinkedIn / X) — edits can't change those, but the archive always updates and any not-yet-sent channel publishes the edited content. Backend changes are serialization-only: the admin archive GET now exposes `reviewed` + the three publish timestamps (never on the public route); the existing `PATCH /api/admin/archives/:runId` re-save and sent-channel-skip semantics were locked by new tests. No new endpoints, migrations, or env vars.

## Artifacts

| Artifact | Purpose |
|---|---|
| [design.md](design.md) | Architectural design — problem, requirements (F1–F6, EC1–EC7), chosen approach, sequence diagram |
| [spec.md](spec.md) | EARS requirements (REQ-001..008), edge cases (EDGE-001..006), verification matrix + scenarios |
| [plan.md](plan.md) | 3-phase implementation plan with context-map/decision/standards compliance notes |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — pure-internal feature, no external dependencies |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict + per-claim evidence |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap adversarial pass — 8 attack scenarios, 0 defects |
| [verification/quality-gate.md](verification/quality-gate.md) | Quality gate 9/9 PASS with verbatim command outputs |
| [verification/screenshots/](verification/screenshots/) | Per-claim Playwright MCP screenshots |

**Library probe:** NOT_APPLICABLE (no external deps; no alternatives tried).

**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/260
