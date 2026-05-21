# Adversarial Findings — e2e-archives-social-collectors

**Date:** 2026-05-21
**Verdict:** PASS

## Attack Surface Derived

- Archive public detail boundary: missing UUID and invalid run id should not leak draft or internal state.
- Review remove flow boundary: removing every card must not allow a reviewed empty archive to be saved accidentally.
- Review inline-edit boundary: whitespace-only edits must not replace a meaningful recap title.
- Claim coverage gap: API/DB worker and collector claims are covered by phase E2E suites; the adversarial pass focused on UI and API boundaries not directly covered by those assertions.

## Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|---|---|---|---|---|
| ADV-API-1 | Boundary input | Public archive detail for a valid but missing UUID returns not found. | `GET /api/archives/00000000-0000-4000-8000-000000000000` | EXPECTED |
| ADV-API-2 | Boundary input | Public archive detail for a non-UUID id returns not found without leaking validation internals. | `GET /api/archives/not-a-uuid` | EXPECTED |
| ADV-UI-1 | Unexpected sequence | Remove all review cards and verify the save path stays disabled rather than publishing an empty archive. | Remove every card from a seeded draft archive. | EXPECTED |
| ADV-UI-2 | Boundary input | Inline edit a title to whitespace and verify the previous meaningful title remains visible. | Set title field to whitespace and blur. | EXPECTED |

## Defects

No defects found.

## Cannot Assess

- Real LinkedIn, Twitter, and Tavily network behavior was not adversarially exercised here. The spec intentionally uses mocked LinkedIn/Twitter and skips Tavily when `TAVILY_API_KEY` is not present in the test process.

## Evidence

- ADV-API-1: `verification/api/ADV-API-missing-runid.txt` shows body `{"error":"not found"}` with HTTP `404`.
- ADV-API-2: `verification/api/ADV-API-invalid-runid.txt` shows body `{"error":"not found"}` with HTTP `404`.
- ADV-UI-1: `verification/screenshots/ADV-UI-remove-all-disabled.png` captures the review UI with the destructive empty-list path guarded.
- ADV-UI-2: `verification/screenshots/ADV-UI-whitespace-title-ignored.png` captures the inline-edit boundary after attempting whitespace input.
- Browser console traces: `verification/traces/adversarial-console-errors.txt` reports 0 errors and 0 warnings.

## Honest Declaration

No defects found across 4 scenarios attempted. Categories exercised: API boundary inputs, UI unexpected sequence, and UI invalid field input. The most promising attack was the all-items-removed review state because it could have published a reviewed empty archive; the UI kept that path guarded and did not expose a broken save state.
