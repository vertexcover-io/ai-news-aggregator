# SPEC: Headline Rank Change Sync

**Source:** `docs/spec/headline-rank-change-sync/design.md`
**Generated:** 2026-05-25

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When an admin saves a reviewed archive with a different rank-one item, the system shall persist `run_archives.digest_headline` from the effective title of the saved rank-one item. | After `PATCH /api/admin/archives/:runId`, the returned archive row and subsequent repository lookup expose `digestHeadline` equal to the saved rank-one title. | Must |
| REQ-002 | Event-driven | When an admin saves a reviewed archive with a different rank-one item, the system shall persist `run_archives.digest_summary` from the effective summary of the saved rank-one item. | After `PATCH /api/admin/archives/:runId`, the returned archive row and subsequent repository lookup expose `digestSummary` equal to the saved rank-one summary when one exists. | Must |
| REQ-003 | Ubiquitous | The system shall derive reviewed digest fields using inline review overrides before recap metadata before raw item fields. | A test fixture with inline rank-one `title` and `summary` persists those inline values even when raw recap values differ. | Must |
| REQ-004 | Event-driven | When reviewed ranked items are saved, the system shall update `search_text` from the same reviewed digest fields persisted to the archive row. | A repository update receives derived digest fields and the resulting `searchText` contains the derived headline and summary, not the pre-review values. | Must |
| REQ-005 | Ubiquitous | The system shall update reviewed digest fields atomically with `ranked_items`. | The archive update statement sets `rankedItems`, `digestHeadline`, `digestSummary`, `searchText`, `reviewed`, and `updatedAt` in one repository call. | Must |
| REQ-006 | Unwanted | If an effective rank-one value is an empty string and a non-empty fallback exists, then the system shall not persist an empty archive digest field. | A fixture with `title: ""` and non-empty raw recap title persists the recap title as `digestHeadline`. | Should |
| REQ-007 | State-driven | While rendering email for a reviewed archive, the system shall use the reviewed digest fields that were persisted by review save. | Existing newsletter-send tests or a new test fixture observe `renderNewsletter` called with the post-review `digestHeadline` and `digestSummary`. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Admin removes the original first item and saves. | The new first item becomes `digestHeadline`; its effective summary becomes `digestSummary`. | REQ-001, REQ-002 |
| EDGE-002 | Admin drags a lower item to rank one and saves. | The promoted item becomes the digest source without changing non-lead item content. | REQ-001, REQ-002 |
| EDGE-003 | Admin edits the first item title and summary inline before saving. | Inline title and summary become the persisted digest fields. | REQ-003 |
| EDGE-004 | Rank-one item has no recap summary and no inline summary. | Existing non-empty digest summary may remain as fallback; no exception is thrown. | REQ-002 |
| EDGE-005 | Rank-one inline title is whitespace only. | The system falls back to recap title or raw title for the archive digest headline. | REQ-006 |
| EDGE-006 | Review save contains an unknown raw item id. | Existing validation rejects the request before any digest or ranked item update. | REQ-005 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | Service/repository test for removed/promoted rank-one item. |
| REQ-002 | Yes | Yes | No | No | Service/repository test for new rank-one summary. |
| REQ-003 | Yes | Yes | No | No | Pure helper plus patchArchive precedence fixture. |
| REQ-004 | Yes | Yes | No | No | Repository mock or DB test asserts search text source. |
| REQ-005 | No | Yes | No | No | Repository update path returns row with all persisted fields. |
| REQ-006 | Yes | No | No | No | Pure helper fallback fixture. |
| REQ-007 | Yes | No | No | No | Existing worker render call can be covered with persisted archive fixture. |
| EDGE-001 | Yes | Yes | No | No | Patch save fixture excludes original first item. |
| EDGE-002 | Yes | Yes | No | No | Patch save fixture reorders ids. |
| EDGE-003 | Yes | Yes | No | No | Patch save fixture includes inline overrides. |
| EDGE-004 | Yes | No | No | No | Helper fixture with missing rank-one summary. |
| EDGE-005 | Yes | No | No | No | Helper trims blank digest candidate. |
| EDGE-006 | Yes | No | No | No | Existing validation path remains unchanged. |

## Verification Scenarios

No VS-0 external dependency probes are required for this spec.

## Out of Scope

- Regenerating a new model-written digest headline or "Plus" summary during review save.
- Adding review UI controls for manually editing archive-level digest fields.
- Changing public archive row design or email template layout.
- Backfilling existing reviewed archives.
- Changing social post copy semantics beyond consuming the corrected persisted digest fields.
