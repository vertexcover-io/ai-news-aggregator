# Run Telemetry — Live Logs, Verbose Failures, Source-Items Dropdown Fix

**Status:** Verification PASSED — see [`verification/proof-report.md`](./verification/proof-report.md).
**Branch:** `feat/run-telemetry-live-logs`
**PR:** _(to be filled in after `gh pr create`)_

## Summary

Three operator-quality fixes to the per-run observability page (`/admin/runs/:runId`):

1. **Web-collector and crawler events now stream into the Debug Timeline in real time.** Every milestone event the web collector emits (`collector.web.listing_completed`, `collector.web.discovery_failed`, `web.extract.failed`, `crawler.stats`, etc.) is routed through the existing `RunLogger`, lands in the `run_logs` table, and surfaces in the page within one poll cycle (≤ 2 s). Levels are mapped explicitly per call site (info / warn / error) per REQ-009.
2. **The per-source items dropdown is no longer empty when the row shows N items.** Root cause was a key mismatch between the source row identifier (full listing URL) and the items' identifier (URL hostname). Fixed by deriving the source row identifier via the same `deriveRawItemIdentifier` helper the items use.
3. **Link-enrichment failures now appear in the Failure Cards section.** Previously they bumped a counter silently. Each failure now emits a `run_logs` row at `level="error"` with verbose context (`url`, `failureReason`, `step`, `originatingCollector`) so the operator can triage at a glance.

The 2-second react-query poll satisfies "live" once events land in `run_logs` — no SSE/WebSocket layer was needed.

## Artifacts (reviewer index)

| File | Purpose |
|------|---------|
| [`design.md`](./design.md) | Problem statement, approach, trade-offs, out-of-scope. |
| [`library-probe.md`](./library-probe.md) | NOT_APPLICABLE — no external dependencies introduced. |
| [`spec.md`](./spec.md) | 10 EARS requirements, 10 verification scenarios. |
| [`plan.md`](./plan.md) | 3-phase implementation plan with file-level changes. |
| [`verification/proof-report.md`](./verification/proof-report.md) | Functional verification verdict + per-claim evidence. |
| [`verification/adversarial-findings.md`](./verification/adversarial-findings.md) | Role-swap adversarial pass — 0 defects found. |
| [`verification/screenshots/`](./verification/screenshots/) | Playwright MCP screenshots for VS-9 (Debug Timeline + Failure Cards) and VS-10 (Source Items dropdown). |

## Library probe

NOT_APPLICABLE — no external library was added, upgraded, or swapped. All changes route existing emissions through the existing in-repo `RunLogger` service and re-use the existing `deriveRawItemIdentifier` helper.

## Tests

- **Unit:** 10 new tests in `packages/pipeline/src/services/__tests__/run-logger.test.ts` + `link-enrichment/__tests__/index.test.ts` + extended tests in `packages/pipeline/tests/unit/collectors/web.test.ts` + new `packages/pipeline/tests/unit/services/web-crawler.test.ts`. Total pipeline unit suite: **1063 / 1063 passing**.
- **E2E:** 3 new tests in `packages/api/tests/e2e/observability-extended.e2e.test.ts` covering VS-6 (observability surfaces new events), VS-7 (source-items dropdown populated after identifier fix), VS-8 (legacy archive returns 200 + empty list).
- **UI proof:** 3 Playwright MCP screenshots committed under `verification/screenshots/`.

## Migration / deployment notes

- **No schema migration** required.
- **No new env vars.**
- **Behaviour change on new runs:** the persisted `sourceTelemetry[i].identifier` for `blog` sources is now the URL hostname (e.g. `cursor.com`) instead of the full listing URL. Legacy archives keep their pre-fix identifier and continue to show empty dropdowns — accepted per design (no backfill, mirroring the precedent set by `published_at` and `recap.title`).
