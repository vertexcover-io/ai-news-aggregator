# Proof Report — e2e-archives-social-collectors

**Date:** 2026-05-21
**Verdict:** PASS

Functional verification ran against the live local stack with API on `http://localhost:3000`, web on `http://localhost:5173`, PostgreSQL on `localhost:5433`, and Redis on `localhost:6379`.

## Claims Summary

`.harness/e2e-archives-social-collectors/claims.json` aggregates 16 executed assertions across phases 1, 2, and 3: 16 passed, 0 failed. API and DB claims are covered by their E2E suites. UI claims were independently re-proven through a live browser and screenshot evidence.

## UI Proof

| Claim | Requirement | Verdict | Evidence |
|---|---|---|---|
| PHASE1-C7 | REQ-AR-7 remove item, save review, public archive omits removed item | PASS | `verification/screenshots/PHASE1-C7-remove-flow.png` shows the saved public archive rendering only `FV remove kept b18a363f`; `verification/db/ui-db-evidence.json` shows the reviewed archive has one ranked item. |
| PHASE1-C8 | REQ-AR-8 inline edit card title, save review, public archive renders edited title | PASS | `verification/screenshots/PHASE1-C8-inline-edit-flow.png` shows the public archive headline and story heading with `FV inline edited 330c4d50`; `verification/db/ui-db-evidence.json` shows the persisted ranked item title override. |

Open visual review: both screenshots include the page header/back link, archive meta/share region, story content, and lower source link context. No overlap, clipping, broken empty state, or misplaced save/navigation affordance was observed.

## API And DB Coverage

| Claim | Maps To | Verdict | Evidence |
|---|---|---|---|
| PHASE1-C1 | REQ-AR-1 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-1: returns reviewed archives sorted by completed_at desc` |
| PHASE1-C2 | REQ-AR-2 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-2: returns an empty list when only unreviewed archives exist` |
| PHASE1-C3 | REQ-AR-3 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-3: returns archive detail for a reviewed archive` |
| PHASE1-C4 | REQ-AR-4 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-4: returns 404 for an unreviewed archive` |
| PHASE1-C5 | REQ-AR-5 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-5: deletes the archive, email_sends rows, and Redis run key` |
| PHASE1-C6 | REQ-AR-6 | COVERED_BY_E2E | `archives.e2e.test.ts::REQ-AR-6: returns 404 for a valid missing runId` |
| PHASE2-C1 | REQ-WK-1 | COVERED_BY_E2E | `linkedin-post.e2e.test.ts::REQ-WK-1 posts a reviewed archive to LinkedIn and records the post URN` |
| PHASE2-C2 | REQ-WK-2 | COVERED_BY_E2E | `linkedin-post.e2e.test.ts::REQ-WK-2 skips LinkedIn when the archive is already posted` |
| PHASE2-C3 | REQ-WK-3 | COVERED_BY_E2E | `twitter-post.e2e.test.ts::REQ-WK-3 posts a head tweet and reply, then records both tweet ids` |
| PHASE2-C4 | REQ-WK-4 | COVERED_BY_E2E | `twitter-post.e2e.test.ts::REQ-WK-4 marks the head tweet as posted without recording a social failure when the reply fails` |
| PHASE2-C5 | REQ-WK-5 | COVERED_BY_E2E | `daily-run.e2e.test.ts::REQ-WK-5 handles a scheduled daily-run job within 5 seconds and enqueues one run-process job` |
| PHASE2-C6 | REQ-WK-6 | COVERED_BY_E2E | `daily-run.e2e.test.ts::REQ-WK-6 removes the daily-run scheduler when scheduling is disabled` |
| PHASE3-C1 | REQ-CO-1 | COVERED_BY_E2E | `twitter.e2e.test.ts::REQ-CO-1: stores three rettiwt timeline tweets as twitter raw_items` |
| PHASE3-C2 | REQ-CO-2, REQ-CO-3 | COVERED_BY_E2E | `web-search.e2e.test.ts::REQ-CO-2/REQ-CO-3: stores real Tavily results as web_search raw_items when TAVILY_API_KEY is present`; skipped when the test process lacks the key. |

## Adversarial Pass

`verification/adversarial-findings.md` attempted 4 scenarios across API boundary input, UI unexpected sequence, and UI invalid input categories. No defects were found.

Evidence:

- `verification/api/ADV-API-missing-runid.txt`
- `verification/api/ADV-API-invalid-runid.txt`
- `verification/screenshots/ADV-UI-remove-all-disabled.png`
- `verification/screenshots/ADV-UI-whitespace-title-ignored.png`

## Console And Network

- `verification/traces/ui-console-errors.txt`: 0 browser console errors, 0 warnings.
- `verification/traces/adversarial-console-errors.txt`: 0 browser console errors, 0 warnings.
- `verification/traces/ui-network-requests.txt`: expected API requests returned 200; analytics beacon aborts were non-blocking page unload/background telemetry.
- `verification/traces/adversarial-network-requests.txt`: expected API requests returned 200; analytics beacon aborts were non-blocking page unload/background telemetry.

## Not Executed

- Real LinkedIn/Twitter posting was not executed by design; worker E2E tests mock those APIs with `msw`.
- Real Tavily execution did not run when the test process lacked `TAVILY_API_KEY`; the collector test records this as a skip per REQ-CO-3.
