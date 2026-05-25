# Run Observability Page

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
**Quality gate:** ✅ PASS — see [verification/quality-gate.md](verification/quality-gate.md)
**Library probe:** NOT_APPLICABLE (pure-internal feature — no new external dependencies)

## What was built

A centralized per-run observability page at **`/admin/runs/:runId`** (linked from
each dashboard run row's "Details" control) that surfaces what happened during a
newsletter run: detailed debug logs (sources tried, items fetched, stage counts,
errors), full-context failure logs, and source-level telemetry. It is **live**
(~2s react-query poll that stops on terminal status) while a run is in progress
and **persisted forever** so any past run — including one that crashed mid-stage —
can be inspected later.

The page (faithful to the approved Ledger "telemetry readout" mock) renders six
sections: masthead + live status pill, a pipeline funnel
(collected → deduped → shortlisted → ranked with drop annotations), a per-stage
timing rail + LLM cost strip, a per-source telemetry table, a link-enrichment
strip, level=error failure cards (with expandable stack), and a debug timeline
with an All/Info/Warn/Error level filter.

**Persistence** uses two additions: an append-only **`run_logs`** table
(`id bigserial`, `run_id` indexed via `(run_id, id)`, `created_at`, `level`,
`stage`, `source`, `event`, `message`, `context jsonb`) holding milestone events
written best-effort by `createRunLogger(runId)` (a failing insert is caught +
stdout-logged, never failing the run), and a nullable
**`run_archives.run_funnel jsonb`** column written inside the existing finalize
upsert. One composition endpoint **`GET /api/admin/runs/:runId/observability`**
returns a single `RunObservability` payload for both **live** (Redis run-state
non-terminal, no archive row yet → funnel derived from `stage.result` logs,
`live=true`) and **historical** (terminal/expired → funnel/sources/enrichment/cost
from `run_archives` with a log fallback for legacy `run_funnel=null`,
`live=false`) modes.

## Architecture (5 phases)

| Phase | Delivers |
|-------|----------|
| 1 | Shared schema: `run_logs` table, `run_archives.run_funnel` column, migration 0031, observability types (`RunLogEntry`, `RunObservability`, …). |
| 2 | Pipeline: `runLogger` + write repo, milestone events threaded into `run-process.ts`, `run_funnel` persisted at finalize (inside the guaranteed-row upsert). |
| 3 | API: read repo + `buildRunObservability` composition service + `GET /api/admin/runs/:runId/observability` (admin-gated, 404 on unknown). |
| 4 | Web: `useRunObservability` 2s-poll hook, `RunObservabilityPage` + 8 section components, route, dashboard "Details" links. |
| 5 | E2E: live / historical / failure / legacy Playwright scenarios + API + pipeline funnel e2e. |

## Artifacts

- [design.md](design.md) — problem, approaches, chosen architecture, edge cases.
- [spec.md](spec.md) — 28 EARS requirements, 10 edge cases, verification matrix.
- [plan.md](plan.md) — phase graph + codebase context.
- [library-probe.md](library-probe.md) — NOT_APPLICABLE verdict (pure-internal).
- [mocks/run-observability.html](mocks/run-observability.html) — the approved frontend mock (source of truth for layout).
- [verification/proof-report.md](verification/proof-report.md) — functional verification (16 UI claims re-proven via Playwright MCP).
- [verification/adversarial-findings.md](verification/adversarial-findings.md) — 9 adversarial scenarios, 0 defects.
- [verification/quality-gate.md](verification/quality-gate.md) — gate verdict (checks 1-9 PASS).
- [verification/screenshots/](verification/screenshots/) — MCP + e2e screenshots per scenario.
- [learnings.md](learnings.md) — task-specific pipeline-friction learnings.

## Verification at a glance

- **Functional:** all 16 `type:"ui"` claims independently re-proven via Playwright MCP against the real page; live curl confirmed 200/404/400/401 + correct live-vs-historical funnel composition.
- **Tests:** unit shared 232 / pipeline 900 / api 556 / web 675; e2e api 5 + pipeline seam 4 + web Playwright 5 — all green.
- **Adversarial:** orphaned logs → 404, zero sources, 23 KB stack (scrolls, no layout break), null enrichment → zeros, 10 concurrent source rows (id-ascending), filter-empty state, XSS path escaped, unauth → 401 — 0 defects.
- **Build/typecheck/lint:** clean across all 7 packages (0 lint errors; baseline warnings unchanged).

## PR

https://github.com/vertexcover-io/ai-news-aggregator/pull/194
