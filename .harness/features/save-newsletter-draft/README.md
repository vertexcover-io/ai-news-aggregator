# Save newsletter review as draft

**Verification verdict:** PASS — [verification/proof-report.md](verification/proof-report.md) (23 claims proven, all 10 UI claims with independent Playwright MCP screenshots; quality gate 11/11 PASS — [.harness/runtime/save-newsletter-draft/gate-report-post-tdd-001.md](../../runtime/save-newsletter-draft/gate-report-post-tdd-001.md))

The admin can now **Save draft** from the review page of any not-yet-reviewed run. Draft save persists ranked items + digest meta, leaves `reviewed = false`, stamps `draft_saved_at`, and enqueues nothing — the run stays invisible in the public archive and shows a violet **Draft** badge (not "Ready to review") on the dashboard with a Review CTA. A second visit rehydrates the saved state. Clicking **Save & publish** (now explicitly labelled) triggers the existing publish path unchanged. An already-reviewed run's review page shows only a single Save action with no draft button, preventing accidental de-publish. Backend: one new nullable column (`draft_saved_at`), a `publish` flag on the existing PATCH endpoint (default `true` — fully backward-compatible), and an F7 guard rejecting draft saves against already-reviewed archives.

## Artifacts

| Artifact | Purpose |
|---|---|
| [design.md](design.md) | Architectural design — problem, requirements, chosen approach, decisions D-115/D-116 |
| [spec.md](spec.md) | EARS requirements (REQ-001..016), edge cases (EDGE-001..007), verification matrix + scenarios |
| [plan.md](plan.md) | 2-phase implementation plan (Phase 1: backend; Phase 2: web UI) with context-map/decision/standards compliance notes |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — pure-internal feature, no external dependencies |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict + per-claim evidence (23/23 covered) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap adversarial pass — Slack hermeticity confirmed, 0 defects |
| [verification/screenshots/](verification/screenshots/) | Per-claim Playwright MCP screenshots (VS-dashboard-initial, VS-1-review-page-unreviewed, VS-1-dashboard-draft-badge, VS-3-reviewed-run-single-save) |

**New decisions:** D-115 (`publish` flag on existing PATCH — not a new endpoint), D-116 (`draft_saved_at` nullable column drives `deriveStatus` "draft").

**New migration:** `packages/shared/src/db/migrations/0039_narrow_silver_samurai.sql` — `ALTER TABLE run_archives ADD COLUMN draft_saved_at timestamp with time zone`.

**Library probe:** NOT_APPLICABLE (no external deps; no alternatives tried).
