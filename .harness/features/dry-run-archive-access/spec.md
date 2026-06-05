# SPEC: Dry-Run Archive — Hidden from Listing, Accessible by Direct Link

**Source:** docs/spec/dry-run-archive-access/design.md
**Generated:** 2026-05-25
**Library probe:** NOT_APPLICABLE (no external dependencies)

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When `GET /api/archives/:runId` is requested for an archive that is a dry run AND `reviewed = true` AND `status = "completed"`, the system shall return HTTP 200 with the archive body. | Response status is 200; body contains the archive's `rankedItems` and `runId`; no auth cookie required. | Must |
| REQ-002 | Unwanted | If `GET /api/archives/:runId` is requested for a dry-run archive where `reviewed = false`, then the system shall return HTTP 404 `{ error: "not found" }`. | Response status is 404; body equals `{ "error": "not found" }`. | Must |
| REQ-003 | Ubiquitous | The system shall exclude dry-run archives from the public archive listing `GET /api/archives`. | Listing response never contains an archive whose `is_dry_run = true`, regardless of `reviewed`. | Must |
| REQ-004 | Ubiquitous | The system shall exclude dry-run archives from the public archive search `GET /api/archives/search`. | Search response never contains an archive whose `is_dry_run = true`. | Must |
| REQ-005 | Event-driven | When `GET /api/archives/:runId` is requested for a non-dry-run (live) reviewed archive, the system shall return HTTP 200 with the archive body. | Response status is 200; behavior unchanged from before the fix (regression guard). | Must |
| REQ-006 | Event-driven | When the public `/archive/:runId` page is opened with no auth cookie for a reviewed completed dry run, the system shall render the digest content. | Page shows the digest headline/stories, not the "Couldn't load this issue" error state and not the "isn't ready yet" state. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Dry run with `reviewed = true` but `status = "failed"` or `"cancelled"`. | Public detail route returns 200 (route gates on `reviewed` only, matching live-archive behavior); the frontend renders its existing "isn't ready yet" non-completed state. No 500. | REQ-001 |
| EDGE-002 | `runId` does not exist at all. | 404 `{ error: "not found" }` — unchanged. | REQ-002 |
| EDGE-003 | Dry run reviewed and completed appears via direct link but a concurrent listing request runs. | Direct link returns the archive (200); listing still omits it. The two surfaces stay consistent with their respective contracts. | REQ-001, REQ-003 |
| EDGE-004 | Admin `GET /api/admin/archives/:runId` for a dry run. | Still returns 200 with `isDryRun: true` — admin route is unchanged by this fix (regression guard). | REQ-005 |
| EDGE-005 | Live (non-dry) archive with `reviewed = false`. | 404 — unchanged; the reviewed gate still applies to all archives. | REQ-002, REQ-005 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | Yes | No | Unit: route returns 200 for reviewed dry run. E2E: Playwright no-auth navigation. |
| REQ-002 | Yes | No | No | No | Route returns 404 for un-reviewed dry run. |
| REQ-003 | Yes | No | Yes | No | `listReviewed` excludes dry run; E2E confirms listing omits it. |
| REQ-004 | Yes | No | No | No | `searchReviewed` excludes dry run. |
| REQ-005 | Yes | No | No | No | Regression: live reviewed archive still 200; admin route still 200. |
| REQ-006 | No | No | Yes | No | Playwright MCP: page renders digest for dry run with no auth cookie. |
| EDGE-001 | Yes | No | No | No | Route 200 for reviewed non-completed dry run. |
| EDGE-002 | Yes | No | No | No | Missing runId 404. |
| EDGE-003 | Yes | No | No | No | Listing omits a reviewed completed dry run. |
| EDGE-004 | Yes | No | No | No | Admin route 200 for dry run (unchanged). |
| EDGE-005 | Yes | No | No | No | Live un-reviewed archive 404. |

## Verification Scenarios (VS-0)

No external-library probe scenarios — library probe verdict is NOT_APPLICABLE. The verification scenarios
are the unit tests and the Playwright E2E navigation listed above.

- **VS-1 (E2E, no auth):** Seed a `run_archives` row with `is_dry_run = true`, `reviewed = true`,
  `status = "completed"`, and ≥1 ranked item. With no `admin_session` cookie, navigate to `/archive/<id>`
  and assert the digest renders (story title visible), not the error state. Screenshot captured.
- **VS-2 (E2E, listing):** With the same seed, navigate to `/` and assert the dry-run issue does NOT appear
  in the listing. Screenshot captured.

## Out of Scope

- **Schema changes** — `run_archives.is_dry_run` already exists; no migration.
- **Admin route changes** — `GET /api/admin/archives/:runId` is unchanged.
- **Frontend component changes** — `ArchivePage.tsx`, `RunsTable.tsx`, `RunsCardList.tsx` are unchanged.
  The "View Archive" button intentionally remains shown for reviewed dry runs (it now links to a working page).
- **Hiding the dry run from the dashboard** — dry runs continue to appear in the admin dashboard runs table.
- **Auth/obfuscation of the direct link** — the runId UUID is the only access control by design; no new
  tokenization, signing, or expiry is added.
- **Listing/search SQL** — the `is_dry_run = false` filter in `listReviewed`/`searchReviewed`/
  `findLatestReviewedSince` is kept verbatim; not refactored.
