# SPEC: Record Review Edits as Signals

**Source:** docs/spec/record-review-edits-as-signals/design.md
**Generated:** 2026-05-28

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When the rank-finalize stage writes a new `run_archives` row, the system shall persist a `pre_review_snapshot` JSONB value containing `capturedAt`, `rankedItemIds` (ordered raw_item id list), `recap` (keyed by raw_item id, with `title`/`summary`/`bullets`/`bottomLine`), and `digestMeta` (`headline`, `summary`, `hook`, `twitterSummary`). | A run completed via the pipeline produces a `run_archives` row whose `pre_review_snapshot` column matches the LLM-produced ranking and digest meta exactly. | Must |
| REQ-002 | Ubiquitous | The system shall expose a `diffReview(snapshot, patch)` pure function in `@newsletter/shared` returning a typed `ReviewEditRow[]` covering `reorder`, `add`, `remove`, and `text_edit` edit types. | Calling the function with paired snapshot + patch inputs returns a deterministic edit-row array; unit tests cover each edit type and the no-change case. | Must |
| REQ-003 | Event-driven | When `PATCH /api/admin/archives/:runId` succeeds, the system shall replace all `review_edits` rows for that `run_id` with the rows returned by `diffReview(snapshot, patch)` inside the same transaction as the archive UPDATE. | After a PATCH, the `review_edits` table contains exactly the rows representing the diff between snapshot and the patched archive; a follow-up PATCH replaces them. | Must |
| REQ-004 | Event-driven | When the admin GET endpoint `GET /api/admin/archives/:runId` is called, the system shall include `preReviewSnapshot` and `reviewEdits[]` fields in the response payload alongside the existing archive fields. | The admin-gated detail route returns both fields (snapshot is `null` for pre-migration archives; `reviewEdits` is `[]` if no review has occurred). | Must |
| REQ-005 | Ubiquitous | The public archive detail route `GET /api/archives/:runId` shall not include `preReviewSnapshot` or `reviewEdits`. | Public route response shape is byte-identical to current behavior; no new fields leak. | Must |
| REQ-006 | Unwanted | If a PATCH payload is identical to the snapshot, then the system shall complete the PATCH successfully and write zero `review_edits` rows. | A no-op PATCH returns 200 and `SELECT count(*) FROM review_edits WHERE run_id=$1` is 0. | Must |
| REQ-007 | Unwanted | If the snapshot is `NULL` (pre-migration archive) when a PATCH lands, then the system shall apply the archive UPDATE normally and skip `review_edits` materialisation. | Pre-migration archives still patch successfully; no error is raised; no edit rows are written. | Should |
| REQ-008 | State-driven | While `pre_review_snapshot` is non-null on an existing archive, the system shall never overwrite it on subsequent UPDATEs. | Direct repository UPDATE paths exclude `pre_review_snapshot` from the SET clause. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Reorder only — same set of item ids, different order | One `reorder`-type row per item whose position changed, with `position_before` and `position_after` set | REQ-003 |
| EDGE-002 | Admin removes an LLM-ranked item | One `remove` row with `position_before` set, `position_after` null; no `text_edit` rows for that item | REQ-003 |
| EDGE-003 | Admin adds a non-LLM-ranked item (pool promote or add-post) | One `add` row with `position_before` null, `position_after` set | REQ-003 |
| EDGE-004 | Admin edits a recap field (e.g. `bottomLine`) on a ranked item | One `text_edit` row with `field='bottomLine'`, `before`/`after` carrying the strings, `raw_item_id` set | REQ-003 |
| EDGE-005 | Admin edits a digest meta field (e.g. `digestHeadline`) | One `text_edit` row with `field='digest_headline'`, `raw_item_id=null`, `before`/`after` carrying the strings | REQ-003 |
| EDGE-006 | Snapshot insert at rank-finalize fails (DB error) | The archive INSERT fails atomically — no orphan archive without snapshot | REQ-001, NF1 |
| EDGE-007 | PATCH is re-submitted with no edits applied (same payload as current archive) | Second PATCH replaces with the same edit rows; deterministic | REQ-003, REQ-006 |
| EDGE-008 | Archive row is deleted | `review_edits` rows for that run cascade-delete via FK | REQ-003 |
| EDGE-009 | Snapshot recap omits items not in LLM ranking (snapshot only stores ranked items) | `diffReview` treats absence from snapshot ranking as "not ranked" → `add` edit on PATCH if present | REQ-001, REQ-002 |
| EDGE-010 | Public GET on a reviewed archive | Response excludes `preReviewSnapshot` and `reviewEdits` even though they exist in DB | REQ-005 |
| EDGE-011 | Migration runs against populated `run_archives` table | `ALTER TABLE … ADD COLUMN pre_review_snapshot jsonb` (nullable, no default) completes as metadata-only change | REQ-001 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|----|-----------|------------------|----------|-------------|-------|
| REQ-001 | No | Yes | No | No | Pipeline worker integration test asserts snapshot column populated after a run. |
| REQ-002 | Yes | No | No | No | Pure function in `@newsletter/shared` — table-driven tests across all edit types. |
| REQ-003 | No | Yes | No | No | API e2e test PATCHes a fixture archive, asserts `review_edits` row contents. |
| REQ-004 | No | Yes | No | No | API e2e test GETs admin archive route, asserts new fields. |
| REQ-005 | No | Yes | No | No | API e2e test GETs public archive route, asserts new fields absent. |
| REQ-006 | Yes | Yes | No | No | Pure-function unit + API e2e (no-op PATCH writes 0 rows). |
| REQ-007 | No | Yes | No | No | API e2e: insert archive with `pre_review_snapshot=NULL`, PATCH it, assert success + 0 edits. |
| REQ-008 | No | Yes | No | No | Repository unit + integration: subsequent `patchArchive` calls leave snapshot unchanged. |
| EDGE-001 | Yes | No | No | No | diffReview unit test |
| EDGE-002 | Yes | No | No | No | diffReview unit test |
| EDGE-003 | Yes | No | No | No | diffReview unit test |
| EDGE-004 | Yes | No | No | No | diffReview unit test |
| EDGE-005 | Yes | No | No | No | diffReview unit test |
| EDGE-006 | No | Yes | No | No | Pipeline integration with simulated DB error |
| EDGE-007 | Yes | Yes | No | No | diffReview unit + API e2e |
| EDGE-008 | No | Yes | No | No | DB integration: DELETE archive, assert edits cascade |
| EDGE-009 | Yes | No | No | No | diffReview unit test |
| EDGE-010 | No | Yes | No | No | API e2e on public route |
| EDGE-011 | No | Yes | No | No | Migration test with seeded archive row |

## Verification Scenarios

No external dependencies were probed (library-probe = NOT_APPLICABLE). Verification is internal-only:

- **VS-1**: End-to-end live: trigger a manual run via `POST /api/runs/now`, wait for completion, query `run_archives.pre_review_snapshot` for that run, confirm the snapshot's `rankedItemIds` matches the archive's `rankedItems` order at rank-finalize time.
- **VS-2**: PATCH a reviewed archive with mixed edits (reorder + remove + add + text edit + digest meta edit), query `review_edits`, assert exactly the expected rows.
- **VS-3**: Re-PATCH the same archive with a different edit set, assert old rows gone and new rows present.
- **VS-4**: PATCH a pre-migration archive (snapshot=NULL) — assert success and zero edits written.

## Out of Scope

- **Eval Mode C** (scoring new prompt against human-edited order) — deferred to a follow-up PR per user decision; this PR is capture-only.
- **Pattern-mining / LLM prompt-suggestion endpoint** — deferred.
- **Backfilling historical archives** — pre-migration runs stay `pre_review_snapshot=NULL`.
- **Tracking individual admin identity** on edits (single shared password today; `created_at` is the only audit field).
- **UI changes** at `/admin/review/:runId` to show edits inline — read-only API exposure only; UI surfacing is a follow-up.
- **Cost tracking** for the diff computation (negligible, no LLM call).
- **Multi-tenant or per-user edit attribution** — not relevant to current single-admin setup.
- **Streaming / incremental edit capture** (per-keystroke) — only PATCH-atomic diffs are recorded.
